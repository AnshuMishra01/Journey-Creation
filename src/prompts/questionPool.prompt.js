/**
 * Question pool generation prompt — generates MCQs per concept.
 */

function buildPrompt(concepts, gradeBand = '9-10') {
  const conceptList = concepts.map((c, i) =>
    `${i + 1}. ${c.name}: ${c.description}\n   Key terms: ${(c.keyTerms || []).join(', ')}`
  ).join('\n');

  return `You are an expert exam question writer for Grade ${gradeBand} students.

IMPORTANT: Your response must be ONLY a valid JSON object. No explanations, no markdown, no thinking, no extra text before or after the JSON. Start your response with { and end with }.

Generate multiple-choice questions (MCQs) for each concept below. Each question must test understanding, not just memorization.

CONCEPTS:
${conceptList}

INSTRUCTIONS:
1. Generate 2-4 questions PER concept (more for complex concepts, fewer for simple ones)
2. Each question must have exactly 4 options (A, B, C, D)
3. Only ONE option should be correct
4. Include a clear explanation for the correct answer
5. Assign difficulty: "easy" (recall), "medium" (understanding), "hard" (application/analysis)
6. Questions should cover different aspects of each concept
7. Distractors (wrong options) should be plausible but clearly wrong
8. Use exact terminology from the concepts

RETURN VALID JSON ONLY (no markdown, no extra text):
{
  "questions": [
    {
      "conceptName": "Name of the concept this question tests",
      "question": "The question text?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Why this answer is correct and others are wrong",
      "difficulty": "medium"
    }
  ]
}

IMPORTANT:
- correctIndex is 0-based (0 = first option, 3 = last option)
- Every question MUST have exactly 4 options
- Do NOT repeat similar questions for the same concept`;
}

function validateResponse(parsed) {
  if (!parsed || !Array.isArray(parsed.questions)) {
    return { isValid: false, error: 'Response must have a "questions" array' };
  }
  if (parsed.questions.length === 0) {
    return { isValid: false, error: 'No questions generated' };
  }

  const valid = [];
  for (const q of parsed.questions) {
    if (!q.question || !Array.isArray(q.options) || q.options.length !== 4) continue;
    const idx = typeof q.correctIndex === 'number' ? q.correctIndex : 0;
    if (idx < 0 || idx > 3) continue;

    valid.push({
      conceptName: q.conceptName || '',
      question: q.question,
      options: q.options,
      correctIndex: idx,
      explanation: q.explanation || '',
      difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
    });
  }

  if (valid.length === 0) {
    return { isValid: false, error: 'No valid questions found after validation' };
  }

  return { isValid: true, questions: valid };
}

module.exports = { buildPrompt, validateResponse };
