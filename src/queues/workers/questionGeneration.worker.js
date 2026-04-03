const { Worker } = require('bullmq');
const { connection } = require('../connection');
const { db } = require('../../db');
const { episodes, concepts, questions, pipelineStages } = require('../../db/schema');
const { eq, and } = require('drizzle-orm');
const { callGemini, GeminiError } = require('../../services/gemini.service');
const questionPrompt = require('../../prompts/questionPool.prompt');

async function updateStage(episodeId, status, extra = {}) {
  await db.update(pipelineStages)
    .set({ status, ...extra })
    .where(and(
      eq(pipelineStages.episodeId, episodeId),
      eq(pipelineStages.stageName, 'question_generation')
    ));
}

const worker = new Worker('question-generation', async (job) => {
  const { episodeId } = job.data;
  console.log(`[QuestionGeneration] Starting for episode ${episodeId}`);

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
    }));

    const prompt = questionPrompt.buildPrompt(conceptData, episode.gradeBand);
    const parsed = await callGemini(prompt);

    // Validate
    const result = questionPrompt.validateResponse(parsed);
    if (!result.isValid) {
      throw new GeminiError(`Question validation failed: ${result.error}`, false);
    }

    // Map conceptName → concept ID for FK linkage
    const conceptMap = {};
    for (const c of episodeConcepts) {
      conceptMap[c.name.toLowerCase()] = c.id;
    }

    // Save questions to DB
    const questionRows = result.questions.map(q => ({
      episodeId,
      conceptId: conceptMap[q.conceptName.toLowerCase()] || null,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      difficulty: q.difficulty,
    }));

    // Delete old questions if retrying
    await db.delete(questions).where(eq(questions.episodeId, episodeId));
    await db.insert(questions).values(questionRows);

    console.log(`[QuestionGeneration] Saved ${questionRows.length} questions for episode ${episodeId}`);

    await updateStage(episodeId, 'completed', { completedAt: new Date() });

    return { questionCount: questionRows.length };

  } catch (err) {
    console.error(`[QuestionGeneration] Failed for episode ${episodeId}:`, err.message);
    await updateStage(episodeId, 'failed', { error: err.message });
    await db.update(episodes).set({ pipelineStatus: 'partial' }).where(eq(episodes.id, episodeId));
    throw err;
  }
}, {
  connection,
  concurrency: 5,
});

worker.on('failed', (job, err) => {
  console.error(`[QuestionGeneration] Job ${job?.id} failed:`, err.message);
});

module.exports = worker;
