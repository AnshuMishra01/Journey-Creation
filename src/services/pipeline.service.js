const { db } = require('../db');
const { episodes, concepts, questions, flashcards, pipelineStages } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { createEpisodePipeline, retrySingleStage, STAGE_NAMES } = require('../queues/episodePipeline.flow');

/**
 * Create a new episode, insert pipeline stage rows, and trigger the DAG.
 */
async function createEpisode({ title, gradeBand, durationMinutes, speaker1Name, speaker2Name, pdfFilename, rawText, voiceConfig }) {
  // Insert episode
  const [episode] = await db.insert(episodes).values({
    title,
    gradeBand: gradeBand || '9-10',
    durationMinutes: durationMinutes || 10,
    speaker1Name: speaker1Name || 'Alex',
    speaker2Name: speaker2Name || 'Sam',
    pdfFilename: pdfFilename || null,
    rawText,
    pipelineStatus: 'pending',
    metadata: voiceConfig ? { voiceConfig } : null,
  }).returning();

  // Insert pipeline stage tracking rows
  const stageRows = STAGE_NAMES.map(name => ({
    episodeId: episode.id,
    stageName: name,
    status: 'pending',
    attempt: 0,
  }));
  await db.insert(pipelineStages).values(stageRows);

  // Trigger the pipeline DAG
  await createEpisodePipeline(episode.id);

  console.log(`[Pipeline] Episode ${episode.id} created and pipeline triggered`);

  return episode;
}

/**
 * Get full episode data with all related records.
 */
async function getEpisode(episodeId) {
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
  if (!episode) return null;

  const [episodeConcepts, episodeQuestions, episodeFlashcards, stages] = await Promise.all([
    db.select().from(concepts).where(eq(concepts.episodeId, episodeId)).orderBy(concepts.orderIndex),
    db.select().from(questions).where(eq(questions.episodeId, episodeId)),
    db.select().from(flashcards).where(eq(flashcards.episodeId, episodeId)),
    db.select().from(pipelineStages).where(eq(pipelineStages.episodeId, episodeId)),
  ]);

  return {
    ...episode,
    concepts: episodeConcepts,
    questions: episodeQuestions,
    flashcards: episodeFlashcards,
    stages: stages.reduce((acc, s) => {
      acc[s.stageName] = {
        status: s.status,
        attempt: s.attempt,
        error: s.error,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      };
      return acc;
    }, {}),
  };
}

/**
 * Get pipeline status for polling.
 */
async function getEpisodeStatus(episodeId) {
  const [episode] = await db.select({
    id: episodes.id,
    title: episodes.title,
    pipelineStatus: episodes.pipelineStatus,
  }).from(episodes).where(eq(episodes.id, episodeId));

  if (!episode) return null;

  const stages = await db.select().from(pipelineStages)
    .where(eq(pipelineStages.episodeId, episodeId));

  return {
    episodeId: episode.id,
    title: episode.title,
    pipelineStatus: episode.pipelineStatus,
    stages: stages.reduce((acc, s) => {
      acc[s.stageName] = {
        status: s.status,
        attempt: s.attempt,
        error: s.error,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      };
      return acc;
    }, {}),
  };
}

/**
 * Retry a specific failed stage.
 */
async function retryStage(episodeId, stageName) {
  // Validate stage name
  const normalizedStage = stageName.replace(/-/g, '_');
  if (!STAGE_NAMES.includes(normalizedStage)) {
    throw new Error(`Invalid stage name: ${stageName}. Valid: ${STAGE_NAMES.join(', ')}`);
  }

  // Check that the stage is actually failed
  const stages = await db.select().from(pipelineStages)
    .where(eq(pipelineStages.episodeId, episodeId));

  const stage = stages.find(s => s.stageName === normalizedStage);
  if (!stage) {
    throw new Error(`Stage ${normalizedStage} not found for episode ${episodeId}`);
  }
  if (stage.status !== 'failed') {
    throw new Error(`Stage ${normalizedStage} is "${stage.status}", not "failed". Can only retry failed stages.`);
  }

  // Reset stage status
  await db.update(pipelineStages).set({
    status: 'pending',
    error: null,
    attempt: stage.attempt + 1,
    startedAt: null,
    completedAt: null,
  }).where(eq(pipelineStages.id, stage.id));

  // Enqueue retry job
  const job = await retrySingleStage(episodeId, normalizedStage);

  return { jobId: job.id, stage: normalizedStage, attempt: stage.attempt + 1 };
}

/**
 * Delete an episode and all related data.
 * FK cascade handles concepts, questions, flashcards, pipeline_stages.
 */
async function deleteEpisode(episodeId) {
  const [episode] = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.id, episodeId));
  if (!episode) return null;

  await db.delete(episodes).where(eq(episodes.id, episodeId));
  console.log(`[Pipeline] Deleted episode ${episodeId}`);
  return { id: episodeId };
}

module.exports = { createEpisode, getEpisode, getEpisodeStatus, retryStage, deleteEpisode };
