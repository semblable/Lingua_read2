namespace LinguaReadApi.Services
{
    public static class SummarizationPrompt
    {
        public static string Build(string text, string sourceLanguage, string targetLanguage, int maxSummaryWords)
        {
            return $@"Summarize the following text from {sourceLanguage} in {targetLanguage}.

Strict instructions:
1. Return ONLY the summary in {targetLanguage}.
2. Keep the summary concise, clear, and useful for language learners.
3. Preserve key events, arguments, names, and important terms.
4. Do not add commentary, labels, markdown headings, code fences, or bullet markers unless the source text requires a list.
5. Aim for no more than {maxSummaryWords} words.

Text to summarize:
{text}";
        }
    }
}
