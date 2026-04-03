/**
 * Refactored script generation prompt — uses structured concepts from DB
 * instead of raw text for the {concepts} placeholder.
 */
const { buildEducationalPrompt } = require('../utils/educationalPrompt');

/**
 * Build a script prompt enriched with structured concept data.
 */
function buildPrompt(metadata, chapterContent, structuredConcepts = []) {
  // Build a rich concept summary from structured data
  let conceptsSummary;
  if (structuredConcepts.length > 0) {
    conceptsSummary = structuredConcepts.map((c, i) =>
      `${i + 1}. ${c.name}: ${c.description}` +
      (c.keyTerms && c.keyTerms.length > 0 ? `\n   Key terms: ${c.keyTerms.join(', ')}` : '')
    ).join('\n');
  } else {
    conceptsSummary = 'Auto-extracted from content';
  }

  const enrichedMetadata = {
    ...metadata,
    concepts: conceptsSummary,
  };

  return buildEducationalPrompt(enrichedMetadata, chapterContent);
}

/**
 * Validate script response — delegates to existing validator.
 */
function validateResponse(parsed) {
  // The parsed object is already JSON from gemini.service
  if (!parsed || !parsed.title || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    return {
      isValid: false,
      error: `Missing required fields. Got keys: ${parsed ? Object.keys(parsed).join(', ') : 'null'}`,
    };
  }

  return {
    isValid: true,
    script: parsed,
    wordCount: parsed.word_count || 0,
    duration: parsed.estimated_duration_seconds || 0,
  };
}

module.exports = { buildPrompt, validateResponse };
