const axios = require('axios');
const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_PUBLIC_URL } = require('../config/env');
const fs = require('fs');

// Cloudflare API Bearer token (not S3 keys)
const R2_WRITE_TOKEN = process.env.R2_WRITE_TOKEN;
const CF_API_BASE = `https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID}/r2/buckets/${R2_BUCKET_NAME}/objects`;

if (R2_WRITE_TOKEN && R2_ACCOUNT_ID) {
  console.log('[R2] Configured with Cloudflare API token');
} else {
  console.warn('[R2] Missing R2_WRITE_TOKEN or R2_ACCOUNT_ID — audio upload will be skipped');
}

/**
 * Upload audio file to R2 via Cloudflare API and return the public URL.
 */
async function uploadAudio(episodeId, filePath, filename = 'merged.mp3') {
  if (!R2_WRITE_TOKEN || !R2_ACCOUNT_ID) {
    console.warn('[R2] Upload skipped — not configured');
    return { key: null, url: null };
  }

  // Verify file exists
  if (!fs.existsSync(filePath)) {
    console.error(`[R2] File not found: ${filePath}`);
    throw new Error(`Audio file not found at ${filePath}`);
  }

  const key = `episodes/${episodeId}/${filename}`;
  const buffer = fs.readFileSync(filePath);
  const uploadUrl = `${CF_API_BASE}/${key}`;

  console.log(`[R2] Uploading ${key} (${(buffer.length / 1024 / 1024).toFixed(2)} MB) to ${uploadUrl}`);

  let response;
  try {
    response = await axios.put(uploadUrl, buffer, {
      headers: {
        'Authorization': `Bearer ${R2_WRITE_TOKEN}`,
        'Content-Type': 'audio/mpeg',
      },
      maxBodyLength: 100 * 1024 * 1024,
      timeout: 120000,
      validateStatus: () => true, // Don't throw on non-2xx
    });
  } catch (netErr) {
    console.error(`[R2] Network error:`, netErr.message);
    throw new Error(`R2 upload network error: ${netErr.message}`);
  }

  console.log(`[R2] Response status: ${response.status}`);

  if (response.status >= 400) {
    const errBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    console.error(`[R2] Upload failed (${response.status}):`, errBody.substring(0, 500));
    throw new Error(`R2 upload failed (${response.status}): ${errBody.substring(0, 200)}`);
  }

  if (response.data && response.data.success === false) {
    console.error(`[R2] Upload returned errors:`, JSON.stringify(response.data.errors));
    throw new Error(`R2 upload failed: ${JSON.stringify(response.data.errors)}`);
  }

  const url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : key;
  console.log(`[R2] Uploaded successfully → ${url}`);
  return { key, url };
}

/**
 * Delete an audio file from R2.
 */
async function deleteAudio(key) {
  if (!R2_WRITE_TOKEN) return;

  await axios.delete(`${CF_API_BASE}/${key}`, {
    headers: { 'Authorization': `Bearer ${R2_WRITE_TOKEN}` },
  });
  console.log(`[R2] Deleted ${key}`);
}

module.exports = { uploadAudio, deleteAudio };
