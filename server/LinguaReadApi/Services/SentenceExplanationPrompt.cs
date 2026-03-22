namespace LinguaReadApi.Services
{
    /// <summary>
    /// Shared learner-facing prompt for sentence explanations (Gemini + OpenRouter).
    /// </summary>
    public static class SentenceExplanationPrompt
    {
        /// <param name="text">The sentence to explain.</param>
        /// <param name="sourceLanguage">Source language code (e.g. from text).</param>
        /// <param name="explanationLanguage">Language the explanation must be written in.</param>
        public static string Build(string text, string sourceLanguage, string explanationLanguage)
        {
            return $@"Explain the following sentence for a language learner.

Sentence:
{text}

Source language: {sourceLanguage}
Explanation language: {explanationLanguage}

Strict instructions:
1. Return ONLY plain text in {explanationLanguage}.
2. Use exactly these section headers on their own lines, in this order:
Grammar:
Nuance:
Culture/Context:
Natural phrasing:
3. Grammar: Identify the main clause (subject, verb, key complements). Mention important function words or structures (e.g. articles, prepositions, conjunctions, negation, contrast patterns like ""não apenas … mas também …"" / ""not only … but also …""). Keep it compact but precise.
4. Nuance: Explain meaning and tone, not a word-for-word gloss. If the sentence uses idiomatic or domain-specific phrasing (e.g. media, business, sports), say what it implies in context and what a literal translation would miss.
5. Culture/Context: Only if it adds real insight; otherwise write exactly ""None"".
6. Natural phrasing: Give one or two natural ways to express the same idea in {explanationLanguage} in a similar register (e.g. marketing vs neutral). If the source uses a fixed expression, give a natural equivalent rather than a calque.
7. Aim for compact but complete: short paragraphs or bullet-like lines under each section are fine; avoid filler and repetition.
8. Do not use XML/HTML tags, markdown fences, or extra preamble before ""Grammar:"".";
        }
    }
}
