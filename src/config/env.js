require('dotenv').config();

const required = (key) => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

const optional = (key, fallback = '') => process.env[key] || fallback;

module.exports = {
  // Neon DB
  DATABASE_URL: required('DATABASE_URL'),

  // Redis (Upstash)
  REDIS_URL: required('REDIS_URL'),

  // Cloudflare R2
  R2_ACCOUNT_ID: optional('R2_ACCOUNT_ID'),
  R2_BUCKET_NAME: optional('R2_BUCKET_NAME', 'episodes-audio-wivme'),
  R2_PUBLIC_URL: optional('R2_PUBLIC_URL'),

  // Python backend
  PYTHON_BACKEND_URL: optional('PYTHON_BACKEND_URL', 'http://127.0.0.1:8000'),

  // TTS
  TTS_PROVIDER: optional('TTS_PROVIDER', 'google'),
  GOOGLE_HOST_VOICE: optional('GOOGLE_HOST_VOICE', 'en-IN-Chirp3-HD-Puck'),
  GOOGLE_SPEAKER_VOICE: optional('GOOGLE_SPEAKER_VOICE', 'en-IN-Chirp3-HD-Sulafat'),

  // AI Provider: "openai" (default/primary), "gemini", or "" (auto: openai > gemini)
  AI_PROVIDER: optional('AI_PROVIDER', ''),

  // Gemini
  GEMINI_API_KEY: optional('GEMINI_API_KEY'),

  // OpenAI
  OPENAI_API_KEY: optional('OPENAI_API_KEY'),
  OPENAI_MODEL: optional('OPENAI_MODEL', 'gpt-4o'),
};
