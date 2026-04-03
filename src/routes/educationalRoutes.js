const express = require('express');
const multer = require('multer');
const axios = require('axios');
const { extractTextFromPDF, cleanExtractedText, validateEducationalContent } = require('../utils/pdfProcessor');
const { buildEducationalPrompt, extractBasicConcepts, validateEducationalScript } = require('../utils/educationalPrompt');

const router = express.Router();

// Configure multer for PDF uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

/**
 * POST /api/upload-pdf
 * Upload and process PDF file for educational content
 */
router.post('/upload-pdf', upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No PDF file uploaded'
      });
    }

    console.log('Processing PDF upload:', req.file.originalname);

    // Extract text from PDF
    const extractionResult = await extractTextFromPDF(req.file.buffer);
    
    if (!extractionResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to extract text from PDF',
        details: extractionResult.error
      });
    }

    // Clean and validate content
    const cleanedText = cleanExtractedText(extractionResult.text);
    const validation = validateEducationalContent(cleanedText);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'PDF content validation failed',
        details: validation.errors
      });
    }

    // Extract basic concepts for preview
    const concepts = extractBasicConcepts(cleanedText);

    res.json({
      success: true,
      data: {
        filename: req.file.originalname,
        extractedText: cleanedText,
        concepts: concepts,
        metadata: {
          pages: extractionResult.pages,
          wordCount: extractionResult.wordCount,
          extractedAt: extractionResult.extractedAt
        },
        validation: validation
      }
    });

  } catch (error) {
    console.error('PDF upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during PDF processing',
      details: error.message
    });
  }
});

/**
 * POST /api/generate-script
 * Generate educational script using Gemini AI
 */
router.post('/generate-script', async (req, res) => {
  try {
    const {
      chapterContent,
      gradeBand,
      durationMinutes,
      speaker1Name,
      speaker2Name,
      episodeTitle,
      episodeNumber
    } = req.body;

    // Validate required fields
    if (!chapterContent) {
      return res.status(400).json({
        success: false,
        error: 'Chapter content is required'
      });
    }

    console.log('Generating educational script for:', episodeTitle);

    // Build educational prompt
    const metadata = {
      gradeBand: gradeBand || "9-10",
      durationMinutes: parseInt(durationMinutes) || 10,
      speaker1Name: speaker1Name || "Alex",
      speaker2Name: speaker2Name || "Sam",
      episodeTitle: episodeTitle || "Chapter Revision",
      episodeNumber: parseInt(episodeNumber) || 1,
      concepts: extractBasicConcepts(chapterContent)
    };

    const prompt = buildEducationalPrompt(metadata, chapterContent);

    // Call Python backend for Gemini generation
    const pythonBackendUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
    
    const response = await axios.post(`${pythonBackendUrl}/generate`, {
      prompt: prompt,
      history: [] // Fresh conversation for each script
    }, {
      timeout: 120000 // 2 minute timeout for script generation
    });

    if (!response.data || !response.data.response) {
      throw new Error('Invalid response from AI service');
    }

    // Log the raw response for debugging
    console.log('Raw Gemini response length:', response.data.response.length);
    console.log('Raw Gemini response preview:', response.data.response.substring(0, 500));
    console.log('Raw Gemini response ending:', response.data.response.substring(-500));
    
    // Validate and parse the generated script
    const scriptValidation = validateEducationalScript(response.data.response);
    
    if (!scriptValidation.isValid) {
      console.error('Script validation failed:', scriptValidation.error);
      console.error('Raw response that failed validation:', response.data.response);
      
      return res.status(400).json({
        success: false,
        error: 'Generated script validation failed',
        details: scriptValidation.error,
        rawResponse: response.data.response.substring(0, 1000) + '...' // Truncate for response
      });
    }

    res.json({
      success: true,
      data: {
        script: scriptValidation.script,
        metadata: metadata,
        generatedAt: new Date().toISOString(),
        wordCount: scriptValidation.wordCount,
        estimatedDuration: scriptValidation.duration
      }
    });

  } catch (error) {
    console.error('Script generation error:', error);
    
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        error: 'AI service unavailable. Please ensure Python backend is running.',
        details: 'Connection refused to Python backend'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to generate educational script',
      details: error.message
    });
  }
});

/**
 * POST /api/regenerate-script
 * Regenerate script with modified parameters
 */
router.post('/regenerate-script', async (req, res) => {
  try {
    const {
      chapterContent,
      gradeBand,
      durationMinutes,
      speaker1Name,
      speaker2Name,
      episodeTitle,
      episodeNumber,
      modifications
    } = req.body;

    console.log('Regenerating script with modifications:', modifications);

    // Build modified prompt
    const metadata = {
      gradeBand: gradeBand || "9-10",
      durationMinutes: parseInt(durationMinutes) || 10,
      speaker1Name: speaker1Name || "Alex",
      speaker2Name: speaker2Name || "Sam",
      episodeTitle: episodeTitle || "Chapter Revision",
      episodeNumber: parseInt(episodeNumber) || 1,
      concepts: extractBasicConcepts(chapterContent)
    };

    let prompt = buildEducationalPrompt(metadata, chapterContent);

    // Add modification instructions if provided
    if (modifications && modifications.length > 0) {
      prompt += `\n\nADDITIONAL INSTRUCTIONS:\n${modifications}`;
    }

    // Call Python backend
    const pythonBackendUrl = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000';
    
    const response = await axios.post(`${pythonBackendUrl}/generate`, {
      prompt: prompt,
      history: []
    }, {
      timeout: 120000
    });

    const scriptValidation = validateEducationalScript(response.data.response);
    
    if (!scriptValidation.isValid) {
      console.error('Script validation failed:', scriptValidation.error);
      console.error('Raw response:', response.data.response.substring(0, 1000));
      
      return res.status(400).json({
        success: false,
        error: 'Regenerated script validation failed',
        details: scriptValidation.error,
        rawResponse: response.data.response.substring(0, 1000) + '...'
      });
    }

    res.json({
      success: true,
      data: {
        script: scriptValidation.script,
        metadata: metadata,
        regeneratedAt: new Date().toISOString(),
        modifications: modifications,
        wordCount: scriptValidation.wordCount,
        estimatedDuration: scriptValidation.duration
      }
    });

  } catch (error) {
    console.error('Script regeneration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to regenerate educational script',
      details: error.message
    });
  }
});

module.exports = router;