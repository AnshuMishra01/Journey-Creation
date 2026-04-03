const { Worker } = require('bullmq');
const { connection } = require('../connection');
const { db } = require('../../db');
const { episodes, concepts, pipelineStages } = require('../../db/schema');
const { eq, and } = require('drizzle-orm');
const { callGemini, GeminiError } = require('../../services/gemini.service');
const conceptPrompt = require('../../prompts/conceptExtraction.prompt');
const { dispatchParallelStages } = require('../episodePipeline.flow');

async function updateStage(episodeId, status, extra = {}) {
  await db.update(pipelineStages)
    .set({ status, ...extra })
    .where(and(
      eq(pipelineStages.episodeId, episodeId),
      eq(pipelineStages.stageName, 'concept_extraction')
    ));
}

const worker = new Worker('concept-extraction', async (job) => {
  const { episodeId } = job.data;
  console.log(`[ConceptExtraction] Starting for episode ${episodeId}`);

  // Mark stage running
  await updateStage(episodeId, 'running', { startedAt: new Date() });
  await db.update(episodes).set({ pipelineStatus: 'running' }).where(eq(episodes.id, episodeId));

  try {
    // Read raw text from DB
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode || !episode.rawText) {
      throw new GeminiError('Episode not found or missing raw text', false);
    }

    // Build prompt and call Gemini
    const prompt = conceptPrompt.buildPrompt(episode.rawText, episode.gradeBand);
    const parsed = await callGemini(prompt);

    // Validate
    const result = conceptPrompt.validateResponse(parsed);
    if (!result.isValid) {
      throw new GeminiError(`Concept extraction validation failed: ${result.error}`, false);
    }

    // Save concepts to DB
    const conceptRows = result.concepts.map((c, i) => ({
      episodeId,
      name: c.name,
      description: c.description,
      keyTerms: c.keyTerms,
      orderIndex: i,
      sourceText: c.sourceText,
    }));

    // Delete old concepts if retrying
    await db.delete(concepts).where(eq(concepts.episodeId, episodeId));
    await db.insert(concepts).values(conceptRows);

    console.log(`[ConceptExtraction] Saved ${conceptRows.length} concepts for episode ${episodeId}`);

    // Mark completed
    await updateStage(episodeId, 'completed', { completedAt: new Date() });

    // Dispatch parallel stages: script + questions + flashcards → audio → finalize
    await dispatchParallelStages(episodeId);

    return { conceptCount: conceptRows.length };

  } catch (err) {
    console.error(`[ConceptExtraction] Failed for episode ${episodeId}:`, err.message);
    await updateStage(episodeId, 'failed', { error: err.message });
    await db.update(episodes).set({ pipelineStatus: 'partial' }).where(eq(episodes.id, episodeId));

    if (err instanceof GeminiError && !err.retryable) {
      throw err; // BullMQ won't retry non-retryable errors via moveToFailed
    }
    throw err; // BullMQ will retry
  }
}, {
  connection,
  concurrency: 3,
});

worker.on('failed', (job, err) => {
  console.error(`[ConceptExtraction] Job ${job?.id} failed:`, err.message);
});

module.exports = worker;
