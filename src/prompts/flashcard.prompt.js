/**
 * Flashcard generation prompt — generates front/back flashcard pairs per concept.
 */

function buildPrompt(concepts, gradeBand = '9-10') {
  const conceptList = concepts.map((c, i) =>
    `${i + 1}. ${c.name}: ${c.description}\n   Key terms: ${(c.keyTerms || []).join(', ')}\n   Source: ${c.sourceText || 'N/A'}`
  ).join('\n');

  return `You are an expert flashcard creator for Grade ${gradeBand} students preparing for exams.

IMPORTANT: Your response must be ONLY a valid JSON object. No explanations, no markdown, no thinking, no extra text before or after the JSON. Start your response with { and end with }.

Create flashcards for each concept below. Flashcards should help students memorize and understand key information.

CONCEPTS:
${conceptList}

INSTRUCTIONS:
1. Generate 2-3 flashcards PER concept
2. The "front" should be a clear question, prompt, or term
3. The "back" should be a concise, accurate answer or definition
4. Types of flashcards to include:
   - Definition cards: "What is [term]?" → "Definition..."
   - Fact cards: "When did [event] happen?" → "In [year], [details]..."
   - Explanation cards: "Why is [concept] important?" → "Because..."
   - Comparison cards: "Difference between X and Y?" → "X is... while Y is..."
5. Use exact terminology from the source material
6. Keep backs concise (1-3 sentences max)
7. Make fronts specific enough to have a single clear answer

RETURN VALID JSON ONLY (no markdown, no extra text):
{
  "flashcards": [
    {
      "conceptName": "Name of the concept",
      "front": "Question or prompt for the front of the card",
      "back": "Answer or explanation for the back of the card"
    }
  ]
}`;
}

function validateResponse(parsed) {
  if (!parsed || !Array.isArray(parsed.flashcards)) {
    return { isValid: false, error: 'Response must have a "flashcards" array' };
  }
  if (parsed.flashcards.length === 0) {
    return { isValid: false, error: 'No flashcards generated' };
  }

  const valid = [];
  for (const f of parsed.flashcards) {
    if (!f.front || !f.back) continue;
    valid.push({
      conceptName: f.conceptName || '',
      front: f.front,
      back: f.back,
    });
  }

  if (valid.length === 0) {
    return { isValid: false, error: 'No valid flashcards found (all missing front/back)' };
  }

  return { isValid: true, flashcards: valid };
}

module.exports = { buildPrompt, validateResponse };
