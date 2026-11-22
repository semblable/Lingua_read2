namespace LinguaReadApi.Services.Ai
{
    /// <summary>Templates used for AI requests and shown in Settings.</summary>
    public static class AiPromptTemplates
    {
        public const string SentenceTranslation = """
            Translate the following sentence or short passage from {sourceLanguage} to {targetLanguage}.
            **Strict Instructions:**
            1. Return ONLY the translated text in {targetLanguage}.
            2. Do NOT include the original text.
            3. Do NOT use XML/HTML tags such as `<o>` or `<t>`.
            4. Do NOT add explanations, notes, quotes, code fences, or markdown.
            5. Preserve meaning, tone, and punctuation naturally in the target language.
            6. Translate idiomatically, not word-for-word. Avoid literal calques that sound unnatural or shift meaning.

            Text:
            {text}
            """;

        public const string SelectionTranslation = """
            You are translating only a highlighted span from a sentence.
            Source language: {sourceLanguage}
            Target language: {targetLanguage}

            Sentence context:
            {sentenceContext}

            Highlighted text to translate:
            {selectedText}

            Strict instructions:
            1. Translate ONLY the highlighted text, using the sentence context for meaning.
            2. Return ONLY the translated highlighted text.
            3. Do NOT include the original text, explanations, notes, or formatting.
            """;

        public const string FullTextTranslation = """
            Translate the following text from {sourceLanguage} to {targetLanguage}, sentence by sentence.
            **Strict Instructions:**
            1. For EACH sentence in the original text:
               - Output the original sentence wrapped EXACTLY like this: `<o s="N">Original Sentence</o>`
               - Immediately follow it with its translation wrapped EXACTLY like this: `<t s="N">Translated Sentence</t>`
               - Replace 'N' with the sentence number, starting from 1.
            2. Maintain ALL original formatting and punctuation within the sentences inside the tags.
            3. **CRITICAL:** Your response MUST contain ONLY the sequence of `<o s="N">...</o><t s="N">...</t>` pairs. Do NOT include ANY introductory text, concluding remarks, explanations, apologies, code fences, or markdown.
            4. Do NOT escape `<` or `>` and do NOT wrap output in any container tags.
            5. If the input has only one sentence, still output exactly one `<o>` + `<t>` pair.
            6. **Natural, idiomatic translation:** Convey meaning and tone in {targetLanguage}, not word-for-word glosses. For idioms, metaphors, and fixed expressions, use the natural equivalent in the target language. Avoid literal calques that sound wrong or shift meaning (e.g. Portuguese "ganhar o mundo" in culture/media contexts suggests global breakthrough or worldwide impact—prefer natural English such as "take the world by storm", "make waves internationally", or "break through globally"; do not use "conquer the world" unless the source clearly implies conquest).

            Example Input Text:
            Hello world. How are you?

            Example Output:
            <o s="1">Hello world.</o><t s="1">Bonjour le monde.</t><o s="2">How are you?</o><t s="2">Comment allez-vous?</t>

            **Text to translate:**
            {text}
            """;

        public const string SentenceExplanation = """
            Explain the following sentence for a language learner.

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
            3. Grammar: Identify the main clause (subject, verb, key complements). Mention important function words or structures (e.g. articles, prepositions, conjunctions, negation, contrast patterns like "não apenas … mas também …" / "not only … but also …"). Keep it compact but precise.
            4. Nuance: Explain meaning and tone, not a word-for-word gloss. If the sentence uses idiomatic or domain-specific phrasing (e.g. media, business, sports), say what it implies in context and what a literal translation would miss.
            5. Culture/Context: Only if it adds real insight; otherwise write exactly "None".
            6. Natural phrasing: Give one or two natural ways to express the same idea in {explanationLanguage} in a similar register (e.g. marketing vs neutral). If the source uses a fixed expression, give a natural equivalent rather than a calque.
            7. Aim for compact but complete: short paragraphs or bullet-like lines under each section are fine; avoid filler and repetition.
            8. Do not use XML/HTML tags, markdown fences, or extra preamble before "Grammar:".
            """;

        public const string Story =
            "Write a {level} level story in {language} about: {prompt}\n\n" +
            "Requirements:\n" +
            "- Write approximately {maxLength} words\n" +
            "- Use vocabulary and grammar appropriate for {level} level learners\n" +
            "- Include diverse sentence structures\n" +
            "- Use everyday vocabulary with occasional new words for learning\n" +
            "- Return ONLY the story with no additional text or explanations";

        public const string Summarization = """
            Summarize the following text from {sourceLanguage} in {targetLanguage}.

            Strict instructions:
            1. Return ONLY the summary in {targetLanguage}.
            2. Keep the summary concise, clear, and useful for language learners.
            3. Preserve key events, arguments, names, and important terms.
            4. Do not add commentary, labels, markdown headings, code fences, or bullet markers unless the source text requires a list.
            5. Aim for no more than {maxSummaryWords} words.

            Text to summarize:
            {text}
            """;

        public const string VocabularyPractice = """
            For each vocabulary word below, write a short, natural micro-context in {language} that uses the word in a form whose meaning matches its provided translation.

            Vocabulary:
            {wordList}

            Rules:
            1. Grammatical & syntactic analysis: First analyze the word's gender, number, person, and tense. Determine if the word requires specific prepositions or reflexive/clitic pronouns to be grammatically natural.
            2. Form fidelity with clitic allowance: Use the word in the EXACT given form whenever it is grammatically natural. If the word is a verb that natively requires a clitic pronoun (e.g. "-me", "-se", "-nos", "-lhe") to make sense, you MUST attach it appropriately rather than producing broken grammar to keep the form isolated.
            3. Strict logic: Invent scenarios that natively fit the grammar. The context must make strict, real-world logical sense — do not invent illogical physical traits for objects (e.g. a painting does not have feet).
            4. 2–3 short sentences per word. A brief micro-dialogue is fine. The context must read naturally to a {level}-level learner.
            5. Each context is independent — do NOT carry characters or storylines between words.
            6. The "usedForm" field must be the EXACT inflected form you wrote inside the context (including any attached clitic pronoun, hyphens, accents, and casing). It MUST appear verbatim as a substring of "context".
            7. Return ONLY a JSON array, no markdown fences, no commentary, no trailing text. Before outputting, verify each "usedForm" appears verbatim in its "context".

            Format (one object per provided word, in the same order):
            [
              {"term": "<exact term as given>", "usedForm": "<inflected form actually used in context>", "context": "<2–3 sentences>"},
              ...
            ]
            """;
    }
}
