const { Worker } = require('bullmq');
const { connection } = require('../connection');
const { db } = require('../../db');
const { episodes, concepts, flashcards, pipelineStages } = require('../../db/schema');
const { eq, and } = require('drizzle-orm');
const { callGemini, GeminiError } = require('../../services/gemini.service');
const flashcardPrompt = require('../../prompts/flashcard.prompt');

async function updateStage(episodeId, status, extra = {}) {
  await db.update(pipelineStages)
    .set({ status, ...extra })
    .where(and(
      eq(pipelineStages.episodeId, episodeId),
      eq(pipelineStages.stageName, 'flashcard_generation')
    ));
}

const worker = new Worker('flashcard-generation', async (job) => {
  const { episodeId } = job.data;
  console.log(`[FlashcardGeneration] Starting for episode ${episodeId}`);

  await updateStage(episodeId, 'running', { startedAt: new Date() });

  try {
    // Read episode + concepts from DB
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode) throw new GeminiError('Episode not found', false);

    const episodeConcepts = await db.select().from(concepts)
      .where(eq(concepts.episodeId, episodeId))
      .orderBy(concepts.orderIndex);

    if (episodeConcepts.length === 0) {
      throw new GeminiError('No concepts found — concept extraction may have failed', false);
    }

    // Build prompt
    const conceptData = episodeConcepts.map(c => ({
      name: c.name,
      description: c.description,
      keyTerms: c.keyTerms || [],
      sourceText: c.sourceText || '',
    }));

    const prompt = flashcardPrompt.buildPrompt(conceptData, episode.gradeBand);
    const parsed = await callGemini(prompt);

    // Validate
    const result = flashcardPrompt.validateResponse(parsed);
    if (!result.isValid) {
      throw new GeminiError(`Flashcard validation failed: ${result.error}`, false);
    }

    // Map conceptName → concept ID for FK linkage
    const conceptMap = {};
    for (const c of episodeConcepts) {
      conceptMap[c.name.toLowerCase()] = c.id;
    }

    // Save flashcards to DB
    const flashcardRows = result.flashcards.map(f => ({
      episodeId,
      conceptId: conceptMap[f.conceptName.toLowerCase()] || null,
      front: f.front,
      back: f.back,
    }));

    // Delete old flashcards if retrying
    await db.delete(flashcards).where(eq(flashcards.episodeId, episodeId));
    await db.insert(flashcards).values(flashcardRows);

    console.log(`[FlashcardGeneration] Saved ${flashcardRows.length} flashcards for episode ${episodeId}`);

    await updateStage(episodeId, 'completed', { completedAt: new Date() });

    return { flashcardCount: flashcardRows.length };

  } catch (err) {
    console.error(`[FlashcardGeneration] Failed for episode ${episodeId}:`, err.message);
    await updateStage(episodeId, 'failed', { error: err.message });
    await db.update(episodes).set({ pipelineStatus: 'partial' }).where(eq(episodes.id, episodeId));
    throw err;
  }
}, {
  connection,
  concurrency: 5,
});

worker.on('failed', (job, err) => {
  console.error(`[FlashcardGeneration] Job ${job?.id} failed:`, err.message);
});

module.exports = worker;
