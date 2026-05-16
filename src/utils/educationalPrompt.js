/**
 * Educational prompt template for generating revision scripts
 */
let jsonrepair;
try {
  ({ jsonrepair } = require('jsonrepair'));
} catch (error) {
  jsonrepair = null;
}
const EDUCATIONAL_PROMPT_TEMPLATE = `
You are generating an educational revision podcast script for Indian school students preparing for exams.

WORD COUNT: Target {target_words} words, maximum {max_words} words ({duration_minutes} minutes at 130 words/minute).

TASK: Generate a conversational revision dialogue between two Grade {grade_band} students based on this chapter content.

CHAPTER CONTENT:
{chapter_content}

KEY CONCEPTS TO COVER:
{concepts}

SPEAKERS:
- {speaker1_name}: Asks questions, makes mistakes, has misconceptions
- {speaker2_name}: Explains clearly, corrects mistakes, gives textbook definitions

DIALOGUE STYLE:
- Sound like real Grade {grade_band} students (casual, age-appropriate)
- Use phrases like “wait what?”, “oh yeah!”, “remember when teacher said...”
- Include misconceptions and clear corrections
- Reference exact terms, definitions, and facts from the chapter
- Include the listener: “You remember this right?”

STRUCTURE:
- Opening: Students decide to revise the chapter together
- Main: Cover all key concepts from the chapter with Q&A, misconceptions, corrections
- Closing: Quick summary of key terms for the exam

RULES:
- Use ONLY content from the chapter provided above
- Use exact terminology from the textbook
- Stay within {max_words} words maximum
- Plain text only, no markdown formatting

RETURN VALID JSON ONLY (no markdown, no extra text):
IMPORTANT: Do NOT include unescaped double quotes inside JSON string values. Use single quotes or escape as \\”.
{{
  “episode_index”: {episode_number},
  “title”: “Episode {episode_number}: {episode_title}”,
  “estimated_duration_seconds”: {duration_seconds},
  “word_count”: <actual_word_count>,
  “grade_level”: “{grade_band}”,
  “sections”: [
    {{
      “id”: “section_1”,
      “start”: 0,
      “end”: {duration_seconds},
      “type”: “dialogue”,
      “text”: “{speaker1_name}: [dialogue line]\\n{speaker2_name}: [dialogue line]\\n...”
    }}
  ]
}}`;

/**
 * Build educational prompt with user inputs
 * @param {Object} metadata - User-provided metadata
 * @param {string} chapterContent - Extracted PDF content
 * @returns {string} - Complete prompt for Gemini
 */
function buildEducationalPrompt(metadata, chapterContent) {
  const {
    gradeBand = "9-10",
    durationMinutes = 10,
    speaker1Name = "Alex",
    speaker2Name = "Sam",
    episodeNumber = 1,
    episodeTitle = "Chapter Revision",
    concepts = "Auto-extracted from content"
  } = metadata;

  const durationSeconds = durationMinutes * 60;
  // Adjusted for accurate duration: Average speech rate for conversational TTS
  // Using 130 words/minute for natural conversation with pauses
  const targetWords = Math.floor(durationMinutes * 130); // 130 words/minute target
  const maxWords = Math.floor(durationMinutes * 140); // Hard upper limit
  
  console.log(`[Prompt Builder] Duration: ${durationMinutes} min, Target: ${targetWords} words, Max: ${maxWords} words`);

  return EDUCATIONAL_PROMPT_TEMPLATE
    .replace(/{grade_band}/g, gradeBand)
    .replace(/{speaker1_name}/g, speaker1Name)
    .replace(/{speaker2_name}/g, speaker2Name)
    .replace(/{duration_minutes}/g, durationMinutes)
    .replace(/{duration_seconds}/g, durationSeconds)
    .replace(/{target_words}/g, targetWords)
    .replace(/{max_words}/g, maxWords)
    .replace(/{chapter_content}/g, chapterContent)
    .replace(/{episode_number}/g, episodeNumber)
    .replace(/{episode_title}/g, episodeTitle)
    .replace(/{concepts}/g, concepts)
    .replace(/{concept_ids}/g, '["auto_extracted"]');
}

/**
 * Extract meaningful educational concepts from chapter content
 * @param {string} content - Chapter text content
 * @returns {string} - Properly formatted educational concepts
 */
function extractBasicConcepts(content) {
  // For now, let's not try to be too smart about concept extraction
  // Instead, let's provide a summary that the AI can work with
  
  const wordCount = content.split(/\s+/).length;
  const firstParagraph = content.substring(0, 500).trim();
  
  // Extract the first few sentences to understand the topic
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const topicSentences = sentences.slice(0, 3).map(s => s.trim()).join('. ');
  
  return `Topic: Based on the chapter content about ${topicSentences}. Word count: ${wordCount} words. Students should focus on key terms, definitions, important dates, names, and concepts mentioned in the text.`;
}

/**
 * Validate educational script JSON response
 * @param {string} response - Gemini response
 * @returns {Object} - Validation result with parsed script
 */
function validateEducationalScript(response) {
  try {
    console.log('[Validation] Raw response length:', response.length);
    console.log('[Validation] First 200 chars:', response.substring(0, 200));
    
    // Clean response - remove markdown formatting if present
    let cleanResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/^[^{]*/, '') // Remove anything before first {
      .replace(/[^}]*$/, '') // Remove anything after last }
      .trim();
    
    console.log('[Validation] Cleaned response length:', cleanResponse.length);
    console.log('[Validation] Cleaned first 200 chars:', cleanResponse.substring(0, 200));
    
    // Try to find and extract JSON object
    const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanResponse = jsonMatch[0];
      console.log('[Validation] Extracted JSON from match, length:', cleanResponse.length);
    }
    
    // Parse JSON
    let script;
    try {
      script = JSON.parse(cleanResponse);
    } catch (parseError) {
      console.error('[Validation] JSON parse error:', parseError.message);
      console.error('[Validation] Failed JSON (first 500 chars):', cleanResponse.substring(0, 500));

      if (jsonrepair) {
        try {
          const repaired = jsonrepair(cleanResponse);
          script = JSON.parse(repaired);
          console.log('[Validation] JSON repaired successfully');
        } catch (repairError) {
          console.error('[Validation] JSON repair failed:', repairError.message);
          throw new Error(`Failed to parse JSON: ${parseError.message}`);
        }
      } else {
        throw new Error(`Failed to parse JSON: ${parseError.message}`);
      }
    }
    
    console.log('[Validation] Successfully parsed JSON with keys:', Object.keys(script));
    
    // Validate required fields with more flexibility
    const requiredFields = ['title', 'sections'];
    
    const missing = requiredFields.filter(field => !script[field]);
    if (missing.length > 0) {
      console.error('[Validation] Missing required fields:', missing);
      return {
        isValid: false,
        error: `Missing required fields: ${missing.join(', ')}`,
        script: null
      };
    }
    
    // Validate sections
    if (!Array.isArray(script.sections) || script.sections.length === 0) {
      console.error('[Validation] Invalid sections:', script.sections);
      return {
        isValid: false,
        error: 'Script must have at least one section',
        script: null
      };
    }
    
    console.log('[Validation] Validation successful!');
    
    return {
      isValid: true,
      script: script,
      wordCount: script.word_count || 0,
      duration: script.estimated_duration_seconds || 0
    };
    
  } catch (error) {
    console.error('[Validation] Unexpected error:', error);
    return {
      isValid: false,
      error: `Validation error: ${error.message}`,
      script: null
    };
  }
}

module.exports = {
  buildEducationalPrompt,
  extractBasicConcepts,
  validateEducationalScript,
  EDUCATIONAL_PROMPT_TEMPLATE
};