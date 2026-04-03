const express = require('express');
const multer = require('multer');
const router = express.Router();
const { extractTextFromPDF, cleanExtractedText, validateEducationalContent } = require('../utils/pdfProcessor');
const { createEpisode, getEpisode, getEpisodeStatus, retryStage, deleteEpisode } = require('../services/pipeline.service');
const { generateIndianTTS, isIndianVoiceSupported } = require('../utils/indianTTSConfig');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Google TTS client for voice previews — supports file path OR env var JSON
let previewTTSClient = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try { previewTTSClient = new TextToSpeechClient(); } catch {}
} else if (process.env.GOOGLE_TTS_CREDENTIALS_B64) {
  try { previewTTSClient = new TextToSpeechClient({ credentials: JSON.parse(Buffer.from(process.env.GOOGLE_TTS_CREDENTIALS_B64, 'base64').toString('utf8')) }); } catch {}
}

// Available voice options for the frontend
const INDIAN_VOICE_OPTIONS = [
  { id: 'en-IN-Chirp3-HD-Puck', label: 'Puck (Male, Chirp HD)', gender: 'male', tier: 'hd' },
  { id: 'en-IN-Chirp3-HD-Sulafat', label: 'Sulafat (Female, Chirp HD)', gender: 'female', tier: 'hd' },
  { id: 'en-IN-Wavenet-A', label: 'Voice A (Female, WaveNet)', gender: 'female', tier: 'wavenet' },
  { id: 'en-IN-Wavenet-B', label: 'Voice B (Male, WaveNet)', gender: 'male', tier: 'wavenet' },
  { id: 'en-IN-Wavenet-C', label: 'Voice C (Male, WaveNet)', gender: 'male', tier: 'wavenet' },
  { id: 'en-IN-Wavenet-D', label: 'Voice D (Female, WaveNet)', gender: 'female', tier: 'wavenet' },
  { id: 'en-IN-Standard-A', label: 'Voice A (Female, Standard)', gender: 'female', tier: 'standard' },
  { id: 'en-IN-Standard-B', label: 'Voice B (Male, Standard)', gender: 'male', tier: 'standard' },
];

// Multer config — same as educationalRoutes
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  },
});

/**
 * GET /api/voices
 * Returns available TTS voices for the frontend.
 */
router.get('/voices', async (req, res) => {
  // Fetch ElevenLabs voices from public API (no auth needed)
  let elevenlabsVoices = [];
  try {
    const elRes = await axios.get('https://api.elevenlabs.io/v1/voices', { timeout: 5000 });
    elevenlabsVoices = (elRes.data.voices || []).map(v => ({
      id: v.voice_id,
      name: v.name,
      gender: v.labels?.gender || 'unknown',
      accent: v.labels?.accent || '',
      useCase: v.labels?.use_case || '',
      description: v.labels?.description || '',
    }));
  } catch {
    // Fallback if API fails
  }

  res.json({
    success: true,
    data: {
      providers: [
        { id: 'google', label: 'Google Cloud TTS (Indian English)' },
        { id: 'elevenlabs', label: 'ElevenLabs (Premium)' },
      ],
      googleVoices: INDIAN_VOICE_OPTIONS,
      elevenlabsVoices,
    },
  });
});

/**
 * GET /api/voice-preview?provider=google&voiceId=en-IN-Chirp3-HD-Puck
 * Returns a short audio sample for the selected voice.
 */
router.get('/voice-preview', async (req, res) => {
  const { provider = 'google', voiceId } = req.query;
  if (!voiceId) return res.status(400).json({ success: false, error: 'voiceId is required' });

  const sampleText = "Hello! I'm your study partner. Let's revise this chapter together and make sure we're ready for the exam.";

  try {
    if (provider === 'elevenlabs') {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(400).json({ success: false, error: 'ElevenLabs API key not configured' });

      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: sampleText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        },
        {
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
          responseType: 'arraybuffer',
          timeout: 30000,
        }
      );
      res.set('Content-Type', 'audio/mpeg');
      res.send(Buffer.from(response.data));

    } else {
      // Google TTS
      if (!previewTTSClient) return res.status(400).json({ success: false, error: 'Google TTS not configured' });

      // Generate to temp file then stream it
      const tmpDir = path.join(__dirname, '..', '..', 'outputs', 'previews');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, `preview-${voiceId.replace(/[^a-zA-Z0-9-]/g, '_')}.mp3`);

      await generateIndianTTS(sampleText, voiceId, tmpFile, previewTTSClient);

      res.set('Content-Type', 'audio/mpeg');
      const stream = fs.createReadStream(tmpFile);
      stream.pipe(res);
    }
  } catch (err) {
    console.error('[VoicePreview] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/episodes
 * Upload PDF + metadata → create episode → trigger full pipeline → return episodeId immediately.
 */
router.post('/episodes', upload.single('pdfFile'), async (req, res) => {
  try {
    // Validate PDF
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'PDF file is required' });
    }

    // Extract text
    const extraction = await extractTextFromPDF(req.file.buffer);
    if (!extraction.success) {
      return res.status(400).json({ success: false, error: `PDF extraction failed: ${extraction.error}` });
    }

    // Clean text
    const cleanedText = cleanExtractedText(extraction.text);

    // Validate content
    const validation = validateEducationalContent(cleanedText);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Content validation failed',
        details: validation.errors,
      });
    }

    // Parse metadata from request body
    const {
      title = 'Chapter Revision',
      gradeBand = '9-10',
      durationMinutes = 10,
      speaker1Name = 'Alex',
      speaker2Name = 'Sam',
      ttsProvider = 'google',
      speaker1Voice = '',
      speaker2Voice = '',
      elevenlabsSpeaker1VoiceId = '',
      elevenlabsSpeaker2VoiceId = '',
    } = req.body;

    // Build voice config for the audio worker
    const voiceConfig = {
      ttsProvider,
      speaker1Voice: speaker1Voice || process.env.GOOGLE_HOST_VOICE || 'en-IN-Chirp3-HD-Puck',
      speaker2Voice: speaker2Voice || process.env.GOOGLE_SPEAKER_VOICE || 'en-IN-Chirp3-HD-Sulafat',
      elevenlabsSpeaker1VoiceId,
      elevenlabsSpeaker2VoiceId,
    };

    // Create episode and trigger pipeline
    const episode = await createEpisode({
      title,
      gradeBand,
      durationMinutes: parseInt(durationMinutes, 10) || 10,
      speaker1Name,
      speaker2Name,
      pdfFilename: req.file.originalname,
      rawText: cleanedText,
      voiceConfig,
    });

    res.status(201).json({
      success: true,
      data: {
        episodeId: episode.id,
        title: episode.title,
        pipelineStatus: episode.pipelineStatus,
        message: 'Episode created. Pipeline is running in the background.',
      },
    });

  } catch (err) {
    console.error('[EpisodeRoutes] POST /episodes error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/episodes/:id
 * Full episode with concepts, questions, flashcards, audio URL.
 */
router.get('/episodes/:id', async (req, res) => {
  try {
    const episode = await getEpisode(req.params.id);
    if (!episode) {
      return res.status(404).json({ success: false, error: 'Episode not found' });
    }

    res.json({
      success: true,
      data: {
        id: episode.id,
        title: episode.title,
        gradeBand: episode.gradeBand,
        durationMinutes: episode.durationMinutes,
        speaker1Name: episode.speaker1Name,
        speaker2Name: episode.speaker2Name,
        pipelineStatus: episode.pipelineStatus,
        audioUrl: episode.audioUrl,
        scriptJson: episode.scriptJson,
        concepts: episode.concepts,
        questions: episode.questions,
        flashcards: episode.flashcards,
        stages: episode.stages,
        createdAt: episode.createdAt,
        updatedAt: episode.updatedAt,
      },
    });

  } catch (err) {
    console.error('[EpisodeRoutes] GET /episodes/:id error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/episodes/:id/status
 * Lightweight pipeline status for polling.
 */
router.get('/episodes/:id/status', async (req, res) => {
  try {
    const status = await getEpisodeStatus(req.params.id);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Episode not found' });
    }

    res.json({ success: true, data: status });

  } catch (err) {
    console.error('[EpisodeRoutes] GET /episodes/:id/status error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/episodes/:id/retry/:stage
 * Retry a specific failed stage.
 */
router.post('/episodes/:id/retry/:stage', async (req, res) => {
  try {
    const result = await retryStage(req.params.id, req.params.stage);

    res.json({
      success: true,
      data: {
        message: `Stage "${result.stage}" queued for retry (attempt #${result.attempt})`,
        jobId: result.jobId,
        stage: result.stage,
        attempt: result.attempt,
      },
    });

  } catch (err) {
    console.error('[EpisodeRoutes] POST /episodes/:id/retry/:stage error:', err);
    const status = err.message.includes('not found') ? 404 :
                   err.message.includes('not "failed"') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/episodes/:id
 * Delete an episode and all related data (concepts, questions, flashcards, stages).
 * Cascade delete handles child rows automatically.
 */
router.delete('/episodes/:id', async (req, res) => {
  try {
    const result = await deleteEpisode(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Episode not found' });
    }
    res.json({ success: true, data: { message: 'Episode deleted', id: req.params.id } });
  } catch (err) {
    console.error('[EpisodeRoutes] DELETE /episodes/:id error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
