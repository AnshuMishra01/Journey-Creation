/**
 * Concept extraction prompt — extracts structured concepts from raw PDF chapter text.
 */

function buildPrompt(rawText, gradeBand = '9-10') {
  return `You are an expert educational content analyst for Grade ${gradeBand} students.

IMPORTANT: Your response must be ONLY a valid JSON object. No explanations, no markdown, no thinking, no extra text before or after the JSON. Start your response with { and end with }.

Analyze the following chapter text and extract ALL important concepts, terms, and topics.

CHAPTER TEXT:
${rawText}

INSTRUCTIONS:
1. Identify every distinct concept, topic, or key term in the chapter
2. For each concept provide:
   - A clear name (2-5 words)
   - A concise description (1-2 sentences)
   - Key terms associated with this concept (exact words from the text)
   - A relevant source passage from the chapter (the most important sentence or two)
3. Order concepts by their appearance in the chapter
4. Be thorough — do not skip any concept that could appear in an exam
5. Extract AT LEAST 5 concepts, up to 20 for dense chapters

RETURN VALID JSON ONLY (no markdown, no extra text):
{
  "concepts": [
    {
      "name": "Concept Name",
      "description": "Clear 1-2 sentence description of this concept",
      "keyTerms": ["term1", "term2", "term3"],
      "sourcePassage": "Relevant quote or passage from the chapter text"
    }
  ]
}`;
}

function validateResponse(parsed) {
  if (!parsed || !Array.isArray(parsed.concepts)) {
    return { isValid: false, error: 'Response must have a "concepts" array' };
  }
  if (parsed.concepts.length === 0) {
    return { isValid: false, error: 'No concepts extracted' };
  }

  const valid = [];
  for (const c of parsed.concepts) {
    if (!c.name) continue;
    valid.push({
      name: c.name,
      description: c.description || '',
      keyTerms: Array.isArray(c.keyTerms) ? c.keyTerms : [],
      sourceText: c.sourcePassage || '',
    });
  }

  if (valid.length === 0) {
    return { isValid: false, error: 'No valid concepts found (all missing "name")' };
  }

  return { isValid: true, concepts: valid };
}

module.exports = { buildPrompt, validateResponse };
