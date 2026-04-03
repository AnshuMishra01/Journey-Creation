const axios = require('axios');
const { PYTHON_BACKEND_URL } = require('../config/env');

let jsonrepair;
try {
  ({ jsonrepair } = require('jsonrepair'));
} catch {
  jsonrepair = null;
}

// Error classification
const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

// --- Circuit breaker (in-process, no Redis dependency) ---
const circuitBreaker = {
  failures: 0,
  lastFailure: 0,
  threshold: 5,          // Open after 5 consecutive failures
  cooldownMs: 60000,     // Stay open for 60s

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
  },
  recordSuccess() {
    this.failures = 0;
  },
  isOpen() {
    if (this.failures < this.threshold) return false;
    // Check if cooldown has elapsed
    if (Date.now() - this.lastFailure > this.cooldownMs) {
      this.failures = 0; // Reset — allow a probe request
      return false;
    }
    return true;
  },
};

class GeminiError extends Error {
  constructor(message, retryable = false, statusCode = null) {
    super(message);
    this.name = 'GeminiError';
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

/**
 * Parse raw Gemini response text into JSON, with aggressive cleanup for 2.5 Flash thinking output.
 */
function parseGeminiJson(raw) {
  console.log(`[GeminiJSON] Raw response length: ${raw.length}`);

  let cleaned = raw;

  // 1. Remove thinking tags (Gemini 2.5 Flash wraps reasoning in these)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // 2. Remove markdown code fences
  cleaned = cleaned.replace(/```json\s*/gi, '');
  cleaned = cleaned.replace(/```\s*/g, '');

  // 3. Try to find a JSON object { ... } or array [ ... ]
  //    Use a greedy match from the first { to the last }
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);

  // Pick the match that starts earliest in the string
  let jsonStr = null;
  if (objMatch && arrMatch) {
    jsonStr = cleaned.indexOf(objMatch[0]) <= cleaned.indexOf(arrMatch[0]) ? objMatch[0] : arrMatch[0];
  } else {
    jsonStr = (objMatch || arrMatch || [null])[0];
  }

  if (!jsonStr) {
    console.error('[GeminiJSON] No JSON found in response. First 500 chars:', cleaned.substring(0, 500));
    throw new GeminiError('No JSON object or array found in Gemini response', false);
  }

  // 4. Try parsing
  try {
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    console.error('[GeminiJSON] Parse failed, attempting repair. Error:', parseErr.message);
    console.error('[GeminiJSON] JSON candidate (first 300 chars):', jsonStr.substring(0, 300));

    if (jsonrepair) {
      try {
        const repaired = jsonrepair(jsonStr);
        return JSON.parse(repaired);
      } catch (repairErr) {
        console.error('[GeminiJSON] Repair also failed:', repairErr.message);
      }
    }

    // 5. Last resort: try to find a smaller valid JSON block inside
    //    (sometimes Gemini appends extra text after the closing brace)
    try {
      const bracketParse = findBalancedJson(jsonStr);
      if (bracketParse) return JSON.parse(bracketParse);
    } catch {
      // give up
    }

    throw new GeminiError(`JSON parse failed: ${parseErr.message}`, true); // retryable — Gemini might give valid JSON on retry
  }
}

/**
 * Find a balanced JSON object by counting braces from the start.
 */
function findBalancedJson(str) {
  const start = str.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return str.substring(start, i + 1); }
  }
  return null;
}

/**
 * Call the Python Gemini backend and return parsed JSON.
 */
async function callGemini(prompt, { timeout = 120000 } = {}) {
  // Circuit breaker check
  if (circuitBreaker.isOpen()) {
    throw new GeminiError('Circuit breaker open — Gemini API has too many consecutive failures. Waiting for cooldown.', true);
  }

  let response;
  try {
    response = await axios.post(`${PYTHON_BACKEND_URL}/generate`, {
      prompt,
      history: [],
    }, { timeout });
  } catch (err) {
    circuitBreaker.recordFailure();
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      throw new GeminiError('Python backend unavailable. Is it running?', true);
    }
    if (err.response) {
      const status = err.response.status;
      const retryable = RETRYABLE_CODES.has(status);
      throw new GeminiError(
        `Gemini API error (${status}): ${err.response.data?.detail || err.message}`,
        retryable,
        status
      );
    }
    if (err.code === 'ECONNABORTED') {
      throw new GeminiError('Gemini request timed out', true);
    }
    throw new GeminiError(`Network error: ${err.message}`, true);
  }

  circuitBreaker.recordSuccess();

  const raw = response.data?.response;
  if (!raw) {
    throw new GeminiError('Empty response from Gemini', true);
  }

  return parseGeminiJson(raw);
}

/**
 * Call Gemini and return raw text (no JSON parsing).
 */
async function callGeminiRaw(prompt, { timeout = 120000 } = {}) {
  let response;
  try {
    response = await axios.post(`${PYTHON_BACKEND_URL}/generate`, {
      prompt,
      history: [],
    }, { timeout });
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      throw new GeminiError('Python backend unavailable', true);
    }
    if (err.response) {
      const status = err.response.status;
      throw new GeminiError(
        `Gemini API error (${status}): ${err.response.data?.detail || err.message}`,
        RETRYABLE_CODES.has(status),
        status
      );
    }
    throw new GeminiError(`Network error: ${err.message}`, true);
  }

  return response.data?.response || '';
}

module.exports = { callGemini, callGeminiRaw, parseGeminiJson, GeminiError };
