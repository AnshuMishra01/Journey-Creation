const { Worker } = require('bullmq');
const { connection } = require('../connection');
const { db } = require('../../db');
const { episodes, pipelineStages } = require('../../db/schema');
const { eq, and } = require('drizzle-orm');
const { uploadAudio } = require('../../services/r2.service');
const fs = require('fs');
const path = require('path');

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
    // Read episode to get the temp audio path
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode) throw new Error('Episode not found');

    // Check all pipeline stages to determine final status
    const stages = await db.select().from(pipelineStages)
      .where(eq(pipelineStages.episodeId, episodeId));

    const stageMap = {};
    for (const s of stages) {
      stageMap[s.stageName] = s.status;
    }

    const hasFailures = Object.entries(stageMap)
      .filter(([name]) => name !== 'finalize')
      .some(([, status]) => status === 'failed');

    // Upload audio to R2 if audio generation succeeded
    let audioUrl = null;
    let audioStorageKey = null;
    const tempAudioPath = episode.metadata?.tempAudioPath;

    if (tempAudioPath && fs.existsSync(tempAudioPath)) {
      try {
        const result = await uploadAudio(episodeId, tempAudioPath);
        audioUrl = result.url;
        audioStorageKey = result.key;
        console.log(`[Finalize] Audio uploaded to R2: ${audioStorageKey}`);
      } catch (uploadErr) {
        console.error(`[Finalize] R2 upload failed:`, uploadErr.message);
        // Don't fail the whole finalize — mark partial
      }

      // Clean up temp audio directory
      const outputDir = path.dirname(tempAudioPath);
      try {
        fs.rmSync(outputDir, { recursive: true, force: true });
        console.log(`[Finalize] Cleaned up temp dir: ${outputDir}`);
      } catch {
        // Ignore cleanup errors
      }
    } else if (stageMap['audio_generation'] === 'completed') {
      console.warn(`[Finalize] Audio stage completed but temp file not found`);
    }

    // Determine final pipeline status
    let finalStatus;
    if (hasFailures) {
      finalStatus = 'partial';
    } else if (!audioUrl && stageMap['audio_generation'] === 'failed') {
      finalStatus = 'partial';
    } else {
      finalStatus = 'completed';
    }

    // Clean metadata (remove tempAudioPath)
    const cleanMetadata = { ...(episode.metadata || {}) };
    delete cleanMetadata.tempAudioPath;

    // Update episode with final data
    await db.update(episodes).set({
      pipelineStatus: finalStatus,
      audioUrl: audioUrl || episode.audioUrl,
      audioStorageKey: audioStorageKey || episode.audioStorageKey,
      metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : null,
      updatedAt: new Date(),
    }).where(eq(episodes.id, episodeId));

    await updateStage(episodeId, 'completed', { completedAt: new Date() });

    console.log(`[Finalize] Episode ${episodeId} finalized with status: ${finalStatus}`);

    return { finalStatus, audioUrl };

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
