const { Worker } = require('bullmq');
const { connection } = require('../connection');
const { db } = require('../../db');
const { episodes, pipelineStages } = require('../../db/schema');
const { eq, and } = require('drizzle-orm');

async function updateStage(episodeId, status, extra = {}) {
  await db.update(pipelineStages)
    .set({ status, ...extra })
    .where(and(
      eq(pipelineStages.episodeId, episodeId),
      eq(pipelineStages.stageName, 'finalize')
    ));
}

const worker = new Worker('finalize', async (job) => {
  const { episodeId } = job.data;
  console.log(`[Finalize] Starting for episode ${episodeId}`);

  await updateStage(episodeId, 'running', { startedAt: new Date() });

  try {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode) throw new Error('Episode not found');

    // Check all pipeline stages
    const stages = await db.select().from(pipelineStages)
      .where(eq(pipelineStages.episodeId, episodeId));

    const stageMap = {};
    for (const s of stages) stageMap[s.stageName] = s.status;

    const hasFailures = Object.entries(stageMap)
      .filter(([name]) => name !== 'finalize')
      .some(([, status]) => status === 'failed');

    // Determine final status
    let finalStatus;
    if (hasFailures) {
      finalStatus = 'partial';
    } else if (!episode.audioUrl) {
      // Audio worker completed but R2 upload failed
      finalStatus = 'partial';
    } else {
      finalStatus = 'completed';
    }

    // Clean metadata (remove tempAudioPath if present from old runs)
    const cleanMetadata = { ...(episode.metadata || {}) };
    delete cleanMetadata.tempAudioPath;

    await db.update(episodes).set({
      pipelineStatus: finalStatus,
      metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : null,
      updatedAt: new Date(),
    }).where(eq(episodes.id, episodeId));

    await updateStage(episodeId, 'completed', { completedAt: new Date() });

    console.log(`[Finalize] Episode ${episodeId}: status=${finalStatus}, audioUrl=${episode.audioUrl || 'null'}`);

    return { finalStatus };

  } catch (err) {
    console.error(`[Finalize] Failed for episode ${episodeId}:`, err.message);
    await updateStage(episodeId, 'failed', { error: err.message });
    await db.update(episodes).set({ pipelineStatus: 'partial' }).where(eq(episodes.id, episodeId));
    throw err;
  }
}, {
  connection,
  concurrency: 3,
});

worker.on('failed', (job, err) => {
  console.error(`[Finalize] Job ${job?.id} failed:`, err.message);
});

module.exports = worker;
