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

    // Upload audio to R2
    let audioUrl = null;
    let audioStorageKey = null;
    const tempAudioPath = episode.metadata?.tempAudioPath;

    console.log(`[Finalize] tempAudioPath: ${tempAudioPath}`);
    console.log(`[Finalize] File exists: ${tempAudioPath ? fs.existsSync(tempAudioPath) : 'no path'}`);
    console.log(`[Finalize] Audio stage status: ${stageMap['audio_generation']}`);

    if (tempAudioPath && fs.existsSync(tempAudioPath)) {
      const stats = fs.statSync(tempAudioPath);
      console.log(`[Finalize] Audio file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      try {
        const result = await uploadAudio(episodeId, tempAudioPath);
        audioUrl = result.url;
        audioStorageKey = result.key;
        console.log(`[Finalize] Audio uploaded to R2: ${audioUrl}`);
      } catch (uploadErr) {
        console.error(`[Finalize] R2 upload failed:`, uploadErr.message);
        // Still mark partial if upload failed
      }

      // Clean up temp audio directory
      try {
        fs.rmSync(path.dirname(tempAudioPath), { recursive: true, force: true });
        console.log(`[Finalize] Cleaned up temp dir`);
      } catch {}
    } else if (stageMap['audio_generation'] === 'completed') {
      console.warn(`[Finalize] Audio stage completed but temp file not found at: ${tempAudioPath}`);

      // Try to find the audio file in the outputs directory
      const outputBase = path.join(__dirname, '..', '..', '..', 'outputs');
      const episodeDir = path.join(outputBase, `episode-${episodeId}`);
      const mergedPath = path.join(episodeDir, 'merged.mp3');

      console.log(`[Finalize] Checking fallback path: ${mergedPath}`);

      if (fs.existsSync(mergedPath)) {
        console.log(`[Finalize] Found audio at fallback path, uploading...`);
        try {
          const result = await uploadAudio(episodeId, mergedPath);
          audioUrl = result.url;
          audioStorageKey = result.key;
          console.log(`[Finalize] Audio uploaded from fallback: ${audioUrl}`);
        } catch (uploadErr) {
          console.error(`[Finalize] Fallback R2 upload failed:`, uploadErr.message);
        }

        try { fs.rmSync(episodeDir, { recursive: true, force: true }); } catch {}
      } else {
        console.warn(`[Finalize] No audio file found at fallback path either`);
      }
    }

    // Determine final status
    let finalStatus;
    if (hasFailures) {
      finalStatus = 'partial';
    } else if (!audioUrl && stageMap['audio_generation'] === 'completed') {
      // Audio generated but upload failed — still partial
      finalStatus = 'partial';
    } else {
      finalStatus = 'completed';
    }

    // Clean metadata
    const cleanMetadata = { ...(episode.metadata || {}) };
    delete cleanMetadata.tempAudioPath;

    // Update episode
    await db.update(episodes).set({
      pipelineStatus: finalStatus,
      audioUrl: audioUrl || episode.audioUrl,
      audioStorageKey: audioStorageKey || episode.audioStorageKey,
      metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : null,
      updatedAt: new Date(),
    }).where(eq(episodes.id, episodeId));

    await updateStage(episodeId, 'completed', { completedAt: new Date() });

    console.log(`[Finalize] Episode ${episodeId} finalized: status=${finalStatus}, audioUrl=${audioUrl || 'null'}`);

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
