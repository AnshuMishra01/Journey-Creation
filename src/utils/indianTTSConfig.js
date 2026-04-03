/**
 * Indian Google TTS Voice Configuration
 * Optimized for educational content with clear pronunciation
 */

// Actual Google Cloud TTS Indian voices (verified from Google Cloud documentation)
const INDIAN_VOICES = {
  // English with Indian accent - Standard voices
  'en-IN-Standard-A': {
    name: 'en-IN-Standard-A',
    gender: 'female',
    language: 'en-IN',
    description: 'Indian English Female (Standard)',
    recommended: true
  },
  'en-IN-Standard-B': {
    name: 'en-IN-Standard-B', 
    gender: 'male',
    language: 'en-IN',
    description: 'Indian English Male (Standard)',
    recommended: true
  },
  'en-IN-Standard-C': {
    name: 'en-IN-Standard-C',
    gender: 'male',
    language: 'en-IN',
    description: 'Indian English Male Alt (Standard)',
    recommended: true
  },
  'en-IN-Standard-D': {
    name: 'en-IN-Standard-D',
    gender: 'female',
    language: 'en-IN',
    description: 'Indian English Female Alt (Standard)',
    recommended: true
  },
  
  // WaveNet voices (higher quality)
  'en-IN-Wavenet-A': {
    name: 'en-IN-Wavenet-A',
    gender: 'female',
    language: 'en-IN',
    description: 'Indian English Female (WaveNet - High Quality)',
    recommended: true
  },
  'en-IN-Wavenet-B': {
    name: 'en-IN-Wavenet-B',
    gender: 'male',
    language: 'en-IN',
    description: 'Indian English Male (WaveNet - High Quality)',
    recommended: true
  },
  'en-IN-Wavenet-C': {
    name: 'en-IN-Wavenet-C',
    gender: 'male',
    language: 'en-IN',
    description: 'Indian English Male Alt (WaveNet - High Quality)',
    recommended: true
  },
  'en-IN-Wavenet-D': {
    name: 'en-IN-Wavenet-D',
    gender: 'female',
    language: 'en-IN',
    description: 'Indian English Female Alt (WaveNet - High Quality)',
    recommended: true
  },
  
  // English Chirp 3: HD voices (Preview) - Indian English
  'en-IN-Chirp3-HD-Puck': {
    name: 'en-IN-Chirp3-HD-Puck',
    gender: 'male',
    language: 'en-IN',
    description: 'Indian English Male (Chirp 3: HD)',
    recommended: true
  },
  'en-IN-Chirp3-HD-Sulafat': {
    name: 'en-IN-Chirp3-HD-Sulafat',
    gender: 'female',
    language: 'en-IN',
    description: 'Indian English Female (Chirp 3: HD)',
    recommended: true
  },
  
  // Hindi voices
  'hi-IN-Standard-A': {
    name: 'hi-IN-Standard-A',
    gender: 'female',
    language: 'hi-IN',
    description: 'Hindi Female (Standard)',
    recommended: false
  },
  'hi-IN-Standard-B': {
    name: 'hi-IN-Standard-B',
    gender: 'male',
    language: 'hi-IN',
    description: 'Hindi Male (Standard)',
    recommended: false
  },
  'hi-IN-Standard-C': {
    name: 'hi-IN-Standard-C',
    gender: 'female',
    language: 'hi-IN',
    description: 'Hindi Female Alt (Standard)',
    recommended: false
  },
  'hi-IN-Standard-D': {
    name: 'hi-IN-Standard-D',
    gender: 'male',
    language: 'hi-IN',
    description: 'Hindi Male Alt (Standard)',
    recommended: false
  },
  
  // Hindi WaveNet voices
  'hi-IN-Wavenet-A': {
    name: 'hi-IN-Wavenet-A',
    gender: 'female',
    language: 'hi-IN',
    description: 'Hindi Female (WaveNet - High Quality)',
    recommended: false
  },
  'hi-IN-Wavenet-B': {
    name: 'hi-IN-Wavenet-B',
    gender: 'male',
    language: 'hi-IN',
    description: 'Hindi Male (WaveNet - High Quality)',
    recommended: false
  },
  'hi-IN-Wavenet-C': {
    name: 'hi-IN-Wavenet-C',
    gender: 'female',
    language: 'hi-IN',
    description: 'Hindi Female Alt (WaveNet - High Quality)',
    recommended: false
  },
  'hi-IN-Wavenet-D': {
    name: 'hi-IN-Wavenet-D',
    gender: 'male',
    language: 'hi-IN',
    description: 'Hindi Male Alt (WaveNet - High Quality)',
    recommended: false
  },

  // Hindi Chirp 3: HD voices (Preview)
  'hi-IN-Chirp3-HD-Achird': {
    name: 'hi-IN-Chirp3-HD-Achird',
    gender: 'male',
    language: 'hi-IN',
    description: 'Hindi Male (Chirp 3: HD)',
    recommended: true
  },
  'hi-IN-Chirp3-HD-Achernar': {
    name: 'hi-IN-Chirp3-HD-Achernar',
    gender: 'female',
    language: 'hi-IN',
    description: 'Hindi Female (Chirp 3: HD)',
    recommended: true
  }
};

/**
 * Get optimal TTS configuration for educational content
 * @param {string} voiceName - Selected voice name
 * @returns {Object} - TTS request configuration
 */
function getEducationalTTSConfig(voiceName) {
  const voice = INDIAN_VOICES[voiceName];
  
  if (!voice) {
    throw new Error(`Voice ${voiceName} not found in Indian voices configuration`);
  }

  return {
    voice: {
      languageCode: voice.language,
      name: voice.name
    },
    audioConfig: {
      audioEncoding: 'MP3',
      pitch: 0, // Natural pitch
      speakingRate: 1.0, // Normal speaking speed
      volumeGainDb: 0,
      effectsProfileId: ['telephony-class-application'] // Clear audio profile
    }
  };
}

/**
 * Generate audio using Google TTS with Indian voices
 * @param {string} text - Text to convert to speech
 * @param {string} voiceName - Indian voice name
 * @param {string} outPath - Output file path
 * @param {Object} googleTTSClient - Google TTS client instance
 */
/**
 * Split text into chunks that fit Google TTS limits (5000 bytes)
 * @param {string} text - Text to split
 * @returns {Array} - Array of text chunks
 */
function splitTextForTTS(text) {
  const maxBytes = 4500; // Leave some buffer under 5000 byte limit
  const chunks = [];
  
  // Split by sentences first
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = '';
  
  for (const sentence of sentences) {
    const testChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;
    
    // Check if adding this sentence would exceed the limit
    if (Buffer.byteLength(testChunk, 'utf8') > maxBytes && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk = testChunk;
    }
  }
  
  // Add the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

async function generateIndianTTS(text, voiceName, outPath, googleTTSClient) {
  if (!googleTTSClient) {
    throw new Error('Google TTS client not initialized. Please set up service account credentials.');
  }

  const config = getEducationalTTSConfig(voiceName);
  
  try {
    console.log(`[Indian TTS] Generating audio for voice: ${voiceName}`);
    console.log(`[Indian TTS] Text length: ${text.length} characters (${Buffer.byteLength(text, 'utf8')} bytes)`);
    
    // Check if text is too long and needs to be split
    if (Buffer.byteLength(text, 'utf8') > 4500) {
      console.log(`[Indian TTS] Text too long, splitting into chunks...`);
      const chunks = splitTextForTTS(text);
      console.log(`[Indian TTS] Split into ${chunks.length} chunks`);
      
      const audioBuffers = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`[Indian TTS] Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);
        
        const request = {
          input: { text: chunk },
          ...config
        };
        
        const [response] = await googleTTSClient.synthesizeSpeech(request);
        audioBuffers.push(response.audioContent);
        
        // Small delay between requests to avoid rate limiting
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Combine all audio buffers
      const combinedBuffer = Buffer.concat(audioBuffers);
      require('fs').writeFileSync(outPath, combinedBuffer, 'binary');
      console.log(`[Indian TTS] ✅ Combined audio from ${chunks.length} chunks saved to: ${outPath}`);
      
    } else {
      // Text is short enough, process normally
      const request = {
        input: { text: text },
        ...config
      };
      
      const [response] = await googleTTSClient.synthesizeSpeech(request);
      
      // Write MP3 audio content to file
      require('fs').writeFileSync(outPath, response.audioContent, 'binary');
      console.log(`[Indian TTS] ✅ Audio saved to: ${outPath}`);
    }
    
  } catch (error) {
    console.error(`[Indian TTS] ❌ Error generating audio:`, error.message);
    
    if (error.message.includes('UNAUTHENTICATED') || error.message.includes('CREDENTIALS_MISSING')) {
      console.error('[Indian TTS] 🔑 Authentication Error: Google TTS requires service account credentials');
      console.error('[Indian TTS] 📋 Setup Instructions:');
      console.error('[Indian TTS] 1. Go to https://console.cloud.google.com/');
      console.error('[Indian TTS] 2. Create/select a project');
      console.error('[Indian TTS] 3. Enable Text-to-Speech API');
      console.error('[Indian TTS] 4. Create service account in IAM & Admin');
      console.error('[Indian TTS] 5. Download JSON key file');
      console.error('[Indian TTS] 6. Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json');
      throw new Error('Google TTS authentication failed. Please set up service account credentials.');
    }
    
    if (error.message.includes('longer than the limit')) {
      console.error('[Indian TTS] 📏 Text too long error - this should have been handled by chunking');
      console.error('[Indian TTS] Text length:', text.length, 'characters');
      console.error('[Indian TTS] Text bytes:', Buffer.byteLength(text, 'utf8'));
    }
    
    throw error;
  }
}

/**
 * Validate if voice is supported for Indian educational content
 * @param {string} voiceName - Voice name to validate
 * @returns {boolean} - Whether voice is supported
 */
function isIndianVoiceSupported(voiceName) {
  return voiceName in INDIAN_VOICES;
}

/**
 * Get recommended voice pairs for educational dialogues
 * @returns {Array} - Array of recommended voice combinations
 */
function getRecommendedVoicePairs() {
  return [
    {
      speaker1: 'hi-IN-Chirp3-HD-Achird',
      speaker2: 'hi-IN-Chirp3-HD-Achernar',
      description: 'Male + Female Hindi (Chirp 3: HD)'
    }
  ];
}

module.exports = {
  INDIAN_VOICES,
  getEducationalTTSConfig,
  generateIndianTTS,
  isIndianVoiceSupported,
  getRecommendedVoicePairs
};