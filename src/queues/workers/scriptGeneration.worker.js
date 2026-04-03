const { Worker } = require('bullmq');
const { connection } = require('../connection');
const { db } = require('../../db');
const { episodes, concepts, pipelineStages } = require('../../db/schema');
const { eq, and } = require('drizzle-orm');
const { callGemini, GeminiError } = require('../../services/gemini.service');
const scriptPrompt = require('../../prompts/scriptGeneration.prompt');

async function updateStage(episodeId, status, extra = {}) {
  await db.update(pipelineStages)
    .set({ status, ...extra })
    .where(and(
      eq(pipelineStages.episodeId, episodeId),
      eq(pipelineStages.stageName, 'script_generation')
    ));
}

const worker = new Worker('script-generation', async (job) => {
  const { episodeId } = job.data;
  console.log(`[ScriptGeneration] Starting for episode ${episodeId}`);

  await updateStage(episodeId, 'running', { startedAt: new Date() });

  try {
    // Read episode and concepts from DB
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode) throw new GeminiError('Episode not found', false);

    const episodeConcepts = await db.select().from(concepts)
      .where(eq(concepts.episodeId, episodeId))
      .orderBy(concepts.orderIndex);

    // Build prompt with structured concepts
    const metadata = {
      gradeBand: episode.gradeBand,
      durationMinutes: episode.durationMinutes,
      speaker1Name: episode.speaker1Name,
      speaker2Name: episode.speaker2Name,
      episodeNumber: 1,
      episodeTitle: episode.title,
    };

    const structuredConcepts = episodeConcepts.map(c => ({
      name: c.name,
      description: c.description,
      keyTerms: c.keyTerms || [],
      sourceText: c.sourceText || '',
    }));

    const prompt = scriptPrompt.buildPrompt(metadata, episode.rawText, structuredConcepts);
    const parsed = await callGemini(prompt, { timeout: 180000 }); // Script gen can take longer

    // Validate
    const result = scriptPrompt.validateResponse(parsed);
    if (!result.isValid) {
      throw new GeminiError(`Script validation failed: ${result.error}`, false);
    }

    // Save script to episodes table
    await db.update(episodes).set({
      scriptJson: result.script,
      updatedAt: new Date(),
    }).where(eq(episodes.id, episodeId));

    console.log(`[ScriptGeneration] Saved script for episode ${episodeId} (${result.wordCount} words)`);

    await updateStage(episodeId, 'completed', { completedAt: new Date() });

    return { wordCount: result.wordCount, duration: result.duration };

  } catch (err) {
    console.error(`[ScriptGeneration] Failed for episode ${episodeId}:`, err.message);
    await updateStage(episodeId, 'failed', { error: err.message });
    await db.update(episodes).set({ pipelineStatus: 'partial' }).where(eq(episodes.id, episodeId));
    throw err;
  }
}, {
  connection,
  concurrency: 2,
});

worker.on('failed', (job, err) => {
  console.error(`[ScriptGeneration] Job ${job?.id} failed:`, err.message);
});

module.exports = worker;
