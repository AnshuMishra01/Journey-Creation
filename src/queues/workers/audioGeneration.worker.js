const { Worker } = require('bullmq');
const { connection } = require('../connection');
const { db } = require('../../db');
const { episodes, pipelineStages } = require('../../db/schema');
const { eq, and } = require('drizzle-orm');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Reuse existing TTS and merge utilities
const { generateIndianTTS, isIndianVoiceSupported } = require('../../utils/indianTTSConfig');
const { mergeAudiosInOrder } = require('../../../merge_audio');

// Google TTS client initialization
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
let googleTTSClient = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    googleTTSClient = new TextToSpeechClient();
    console.log('[AudioWorker] Google TTS client initialized');
  } catch (err) {
    console.error('[AudioWorker] Google TTS init failed:', err.message);
  }
}

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GOOGLE_HOST_VOICE = process.env.GOOGLE_HOST_VOICE || 'en-IN-Chirp3-HD-Puck';
const GOOGLE_SPEAKER_VOICE = process.env.GOOGLE_SPEAKER_VOICE || 'en-IN-Chirp3-HD-Sulafat';
const OUTPUT_BASE = path.join(__dirname, '..', '..', '..', 'outputs');

async function updateStage(episodeId, status, extra = {}) {
  await db.update(pipelineStages)
    .set({ status, ...extra })
    .where(and(
      eq(pipelineStages.episodeId, episodeId),
      eq(pipelineStages.stageName, 'audio_generation')
    ));
}

/**
 * Extract dialogue lines from script JSON sections.
 */
function extractDialogueLines(scriptJson) {
  const lines = [];
  const speakerRegex = /^([^:]+):\s*(.*)$/;
  let idx = 1;

  for (const section of scriptJson.sections || []) {
    const sectionLines = (section.text || '').split('\n').filter(Boolean);
    for (const line of sectionLines) {
      const match = line.match(speakerRegex);
      if (match) {
        lines.push({ speaker: match[1].trim(), text: match[2].trim(), idx });
        idx++;
      }
    }
  }
  return lines;
}

/**
 * Generate audio via ElevenLabs API.
 */
async function generateElevenLabsTTS(text, voiceId, outPath) {
  if (!ELEVENLABS_API_KEY) throw new Error('ElevenLabs API key not set');
  if (!voiceId) throw new Error('ElevenLabs voice ID not provided');

  let response;
  try {
    response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        responseType: 'arraybuffer',
        timeout: 60000,
        validateStatus: () => true, // Don't throw on non-200
      }
    );
  } catch (netErr) {
    throw new Error(`ElevenLabs network error: ${netErr.message}`);
  }

  if (response.status !== 200) {
    // Parse error body
    let errMsg = `HTTP ${response.status}`;
    try {
      const body = JSON.parse(Buffer.from(response.data).toString());
      errMsg = body.detail?.message || body.detail?.status || errMsg;
    } catch {}
    throw new Error(`ElevenLabs: ${errMsg}`);
  }

  fs.writeFileSync(outPath, response.data);
}

const worker = new Worker('audio-generation', async (job) => {
  const { episodeId } = job.data;
  console.log(`[AudioGeneration] Starting for episode ${episodeId}`);

  await updateStage(episodeId, 'running', { startedAt: new Date() });

  try {
    // Read episode with script from DB
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode) throw new Error('Episode not found');
    if (!episode.scriptJson) throw new Error('No script found — script generation may have failed');

    // Read voice config from episode metadata
    const vc = episode.metadata?.voiceConfig || {};
    const ttsProvider = vc.ttsProvider || 'google';

    // Validate TTS provider is available
    if (ttsProvider === 'google' && !googleTTSClient) {
      throw new Error('Google TTS client not initialized. Set GOOGLE_APPLICATION_CREDENTIALS.');
    }
    if (ttsProvider === 'elevenlabs' && !ELEVENLABS_API_KEY) {
      throw new Error('ElevenLabs API key not set.');
    }

    // Create output directory
    const outputDir = path.join(OUTPUT_BASE, `episode-${episodeId}`);
    fs.mkdirSync(outputDir, { recursive: true });

    // Extract dialogue lines from script
    const dialogueLines = extractDialogueLines(episode.scriptJson);
    if (dialogueLines.length === 0) {
      throw new Error('No dialogue lines found in script');
    }

    // Build speaker → voice mapping based on provider
    const speakers = [...new Set(dialogueLines.map(l => l.speaker))];
    const voiceMap = {};

    if (ttsProvider === 'elevenlabs') {
      const v1 = vc.elevenlabsSpeaker1VoiceId;
      const v2 = vc.elevenlabsSpeaker2VoiceId;
      if (!v1 || !v2) throw new Error('ElevenLabs voice IDs not provided for both speakers');
      speakers.forEach((spk, i) => {
        voiceMap[spk] = i === 0 ? v1 : v2;
      });
    } else {
      const hostVoice = vc.speaker1Voice || GOOGLE_HOST_VOICE;
      const speakerVoice = vc.speaker2Voice || GOOGLE_SPEAKER_VOICE;
      speakers.forEach((spk, i) => {
        voiceMap[spk] = i === 0 ? hostVoice : speakerVoice;
      });
    }

    console.log(`[AudioGeneration] Provider: ${ttsProvider}, ${dialogueLines.length} lines, speakers:`, voiceMap);

    // Generate TTS for each line sequentially
    let successCount = 0;
    let failCount = 0;
    let lastError = '';

    for (const { speaker, text, idx } of dialogueLines) {
      if (!text.trim()) continue;
      const voiceId = voiceMap[speaker];
      const safeSpeaker = speaker.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const outPath = path.join(outputDir, `${safeSpeaker}_line${idx}.mp3`);

      try {
        if (ttsProvider === 'elevenlabs') {
          await generateElevenLabsTTS(text, voiceId, outPath);
        } else {
          if (isIndianVoiceSupported(voiceId)) {
            await generateIndianTTS(text, voiceId, outPath, googleTTSClient);
          } else {
            await generateIndianTTS(text, GOOGLE_HOST_VOICE, outPath, googleTTSClient);
          }
        }
        successCount++;
      } catch (ttsErr) {
        failCount++;
        lastError = ttsErr.message;
        console.error(`[AudioGeneration] TTS failed for line ${idx}:`, ttsErr.message);

        // If quota exceeded or auth error, stop immediately — no point continuing
        if (ttsErr.message.includes('quota_exceeded') || ttsErr.message.includes('401') || ttsErr.message.includes('403')) {
          throw new Error(`TTS quota exceeded or auth failed after ${successCount}/${dialogueLines.length} lines. Error: ${ttsErr.message}`);
        }
      }

      await job.updateProgress(Math.round((idx / dialogueLines.length) * 100));
    }

    console.log(`[AudioGeneration] TTS complete: ${successCount} succeeded, ${failCount} failed out of ${dialogueLines.length} lines`);

    // Fail if more than half the lines failed
    if (successCount === 0) {
      throw new Error(`All ${dialogueLines.length} TTS lines failed. Last error: ${lastError}`);
    }
    if (failCount > dialogueLines.length * 0.5) {
      throw new Error(`Too many TTS failures: ${failCount}/${dialogueLines.length} lines failed. Last error: ${lastError}`);
    }

    // Merge all audio files
    const mergedPath = path.join(outputDir, 'merged.mp3');
    mergeAudiosInOrder(outputDir, mergedPath);

    if (!fs.existsSync(mergedPath)) {
      throw new Error('Audio merge failed — no merged.mp3 produced');
    }

    const stats = fs.statSync(mergedPath);
    console.log(`[AudioGeneration] Merged audio: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Store the temp path in episode metadata for the finalize worker
    await db.update(episodes).set({
      metadata: { ...(episode.metadata || {}), tempAudioPath: mergedPath },
      updatedAt: new Date(),
    }).where(eq(episodes.id, episodeId));

    await updateStage(episodeId, 'completed', { completedAt: new Date() });

    return { mergedPath, lineCount: dialogueLines.length };

  } catch (err) {
    console.error(`[AudioGeneration] Failed for episode ${episodeId}:`, err.message);
    await updateStage(episodeId, 'failed', { error: err.message });
    await db.update(episodes).set({ pipelineStatus: 'partial' }).where(eq(episodes.id, episodeId));
    throw err;
  }
}, {
  connection,
  concurrency: 1,
});

worker.on('failed', (job, err) => {
  console.error(`[AudioGeneration] Job ${job?.id} failed:`, err.message);
});

module.exports = worker;
