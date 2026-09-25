using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services.Ai
{
    /// <summary>Sentence, full-text and selection translation plus sentence explanations through a catalog provider.</summary>
    public class OpenAiCompatibleTranslationService
    {
        private readonly OpenAiCompatibleChatClient _chatClient;
        private readonly ILogger<OpenAiCompatibleTranslationService> _logger;
        private readonly ILanguageService _languageService;

        // Approximate tokens per character (conservative estimate)
        private const double TokensPerChar = 0.4;

        // Model context limits (input tokens, leave room for output)
        private static readonly Dictionary<string, int> ModelContextLimits = new()
        {
            // Free models
            { "google/gemini-2.5-flash-preview-05-20:free", 500000 }, // 1M context, use 500k for input
            { "meta-llama/llama-3.3-8b-instruct:free", 60000 },       // 128k context
            { "qwen/qwen3-4b:free", 30000 },                           // 64k context
            { "mistralai/mistral-small-3.1-24b-instruct:free", 60000 },
            { "deepseek/deepseek-r1:free", 30000 },                    // 64k context
            // Paid models
            { "anthropic/claude-3.5-sonnet", 100000 },                 // 200k context
            { "openai/gpt-4o", 60000 },                                // 128k context
            { "google/gemini-pro-1.5", 500000 },                       // 1M context
            // DeepSeek direct (1M context)
            { "deepseek-flash", 500000 },
            { "deepseek-v4-pro", 500000 },
        };

        // Default limit for unknown models
        private const int DefaultContextLimit = 30000;

        // Max characters per chunk (leaves room for prompt overhead)
        private const int MaxCharsPerChunk = 15000;

        public OpenAiCompatibleTranslationService(
            OpenAiCompatibleChatClient chatClient,
            ILogger<OpenAiCompatibleTranslationService> logger,
            ILanguageService languageService)
        {
            _chatClient = chatClient;
            _logger = logger;
            _languageService = languageService;
        }

        public Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage, AiProviderConnection connection)
        {
            return TranslateAsync(text, sourceLanguage, targetLanguage, connection, includeSentenceTags: false);
        }

        public Task<string> TranslateFullTextAsync(string text, string sourceLanguage, string targetLanguage, AiProviderConnection connection)
        {
            return TranslateAsync(text, sourceLanguage, targetLanguage, connection, includeSentenceTags: true);
        }

        private async Task<string> TranslateAsync(string text, string sourceLanguage, string targetLanguage, AiProviderConnection connection, bool includeSentenceTags)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("Empty text provided for translation");
                return string.Empty;
            }

            try
            {
                var model = connection.ModelFor(AiTask.Translation);
                var finalTargetCode = await ResolveTargetCodeAsync(sourceLanguage, targetLanguage);

                // Validate text length against model context
                var contextLimit = GetModelContextLimit(model);
                var estimatedTokens = (int)(text.Length * TokensPerChar);

                _logger.LogInformation("Translating text ({Length} chars, ~{Tokens} tokens) from {Source} to {Target} using {Provider} model {Model} (limit: {Limit}). TaggedOutput={TaggedOutput}",
                    text.Length, estimatedTokens, sourceLanguage, finalTargetCode, connection.Definition.DisplayName, model, contextLimit, includeSentenceTags);

                // Check if we need chunking
                if (includeSentenceTags && text.Length > MaxCharsPerChunk)
                {
                    _logger.LogInformation("Text exceeds chunk limit ({Length} > {Limit}), splitting into chunks", text.Length, MaxCharsPerChunk);
                    return await TranslateInChunksAsync(text, sourceLanguage, finalTargetCode, connection, model);
                }

                // Validate against context limit
                if (estimatedTokens > contextLimit)
                {
                    _logger.LogWarning("Text ({Tokens} tokens) exceeds model context limit ({Limit}). Consider using a larger model.", estimatedTokens, contextLimit);
                    return $"Translation error: Text too long for selected model ({estimatedTokens} tokens > {contextLimit} limit). Try a model with larger context.";
                }

                return await TranslateSingleChunkAsync(text, sourceLanguage, finalTargetCode, connection, model, includeSentenceTags);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during {Provider} translation", connection.Definition.DisplayName);
                return $"Translation error: {ex.Message}";
            }
        }

        public async Task<string> ExplainSentenceAsync(string text, string sourceLanguage, string targetLanguage, AiProviderConnection connection)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("Empty text provided for sentence explanation");
                return string.Empty;
            }

            try
            {
                var explanationLanguage = await ResolveTargetCodeAsync(sourceLanguage, targetLanguage);

                string defaultExplanationPrompt = SentenceExplanationPrompt.Build(text, sourceLanguage, explanationLanguage);
                var explanationVars = new Dictionary<string, string?>
                {
                    ["text"] = text,
                    ["sourceLanguage"] = sourceLanguage,
                    ["explanationLanguage"] = explanationLanguage,
                    ["targetLanguage"] = explanationLanguage
                };
                string prompt = AiTaskConfig.ResolvePromptOrDefault(
                    connection.Settings.CustomExplanationPrompt,
                    defaultExplanationPrompt,
                    explanationVars,
                    out var unknownExplanationPlaceholders);
                if (unknownExplanationPlaceholders.Count > 0)
                {
                    _logger.LogWarning("Custom explanation prompt contains unknown placeholders: {Placeholders}. Known: text, sourceLanguage, explanationLanguage, targetLanguage.",
                        string.Join(", ", unknownExplanationPlaceholders));
                }

                var request = new ChatCompletionRequest
                {
                    Model = connection.ModelFor(AiTask.Explanation),
                    Messages = new[] { new ChatMessage { Role = "user", Content = prompt } },
                    Temperature = 0.3,
                    MaxTokens = 65535,
                    TopP = 1.0
                };
                AiReasoningOptions.ApplyForTranslation(request, connection.Definition.ReasoningStyle, connection.Settings);

                var result = await _chatClient.CompleteAsync(connection, request, "explanation");
                if (result.IsExtractionFailure) return "Explanation failed: Could not extract result";
                return result.Success ? result.Content! : $"Explanation error: {result.Error}";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during {Provider} sentence explanation", connection.Definition.DisplayName);
                return $"Explanation error: {ex.Message}";
            }
        }

        private async Task<string> ResolveTargetCodeAsync(string sourceLanguage, string targetLanguage)
        {
            if (string.IsNullOrEmpty(sourceLanguage)) return targetLanguage;

            var allLanguages = await _languageService.GetAllLanguagesAsync();
            var sourceLanguageConfig = allLanguages.FirstOrDefault(l => l.Code.Equals(sourceLanguage, StringComparison.OrdinalIgnoreCase));
            if (sourceLanguageConfig != null && !string.IsNullOrEmpty(sourceLanguageConfig.GeminiTargetCode))
            {
                _logger.LogInformation("Using configured target code '{ConfiguredCode}' for source '{SourceCode}'", sourceLanguageConfig.GeminiTargetCode, sourceLanguage);
                return sourceLanguageConfig.GeminiTargetCode;
            }
            return targetLanguage;
        }

        private int GetModelContextLimit(string model)
        {
            if (ModelContextLimits.TryGetValue(model, out var limit))
            {
                return limit;
            }
            _logger.LogDebug("Unknown model '{Model}', using default context limit", model);
            return DefaultContextLimit;
        }

        private async Task<string> TranslateInChunksAsync(string text, string sourceLanguage, string targetLanguage, AiProviderConnection connection, string model)
        {
            // Split text into sentences to maintain meaning
            var chunks = SplitTextIntoChunks(text, MaxCharsPerChunk);
            _logger.LogInformation("Split text into {Count} chunks", chunks.Count);

            var results = new List<string>();
            int chunkIndex = 0;

            foreach (var chunk in chunks)
            {
                chunkIndex++;
                _logger.LogInformation("Translating chunk {Index}/{Total} ({Length} chars)", chunkIndex, chunks.Count, chunk.Length);

                var result = await TranslateSingleChunkAsync(chunk, sourceLanguage, targetLanguage, connection, model, includeSentenceTags: true);

                // Check for errors
                if (result.StartsWith("Translation error:"))
                {
                    _logger.LogWarning("Chunk {Index} failed: {Error}", chunkIndex, result);
                    return result; // Return error and stop
                }

                results.Add(result);

                // Small delay between chunks to avoid rate limiting
                if (chunkIndex < chunks.Count)
                {
                    await Task.Delay(500);
                }
            }

            return string.Join("", results);
        }

        private List<string> SplitTextIntoChunks(string text, int maxChars)
        {
            var chunks = new List<string>();

            // Split by sentences (periods, question marks, exclamation marks followed by space or newline)
            var sentences = Regex.Split(text, @"(?<=[.!?])\s+");

            var currentChunk = new StringBuilder();

            foreach (var sentence in sentences)
            {
                // If adding this sentence would exceed limit, save current chunk
                if (currentChunk.Length + sentence.Length > maxChars && currentChunk.Length > 0)
                {
                    chunks.Add(currentChunk.ToString());
                    currentChunk.Clear();
                }

                // If single sentence is too long, split it further by newlines or force-split
                if (sentence.Length > maxChars)
                {
                    if (currentChunk.Length > 0)
                    {
                        chunks.Add(currentChunk.ToString());
                        currentChunk.Clear();
                    }

                    // Split long sentence by paragraphs/newlines
                    var parts = sentence.Split(new[] { "\n\n", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var part in parts)
                    {
                        if (part.Length > maxChars)
                        {
                            // Force split at max chars
                            for (int i = 0; i < part.Length; i += maxChars)
                            {
                                chunks.Add(part.Substring(i, Math.Min(maxChars, part.Length - i)));
                            }
                        }
                        else
                        {
                            chunks.Add(part);
                        }
                    }
                }
                else
                {
                    if (currentChunk.Length > 0) currentChunk.Append(" ");
                    currentChunk.Append(sentence);
                }
            }

            if (currentChunk.Length > 0)
            {
                chunks.Add(currentChunk.ToString());
            }

            return chunks;
        }

        private async Task<string> TranslateSingleChunkAsync(string text, string sourceLanguage, string targetLanguage, AiProviderConnection connection, string model, bool includeSentenceTags)
        {
            var customPrompt = connection.Settings.CustomTranslationPrompt;
            string defaultTaggedPrompt = $@"Translate the following text from {sourceLanguage} to {targetLanguage}, sentence by sentence.
**Strict Instructions:**
1. For EACH sentence in the original text:
   - Output the original sentence wrapped EXACTLY like this: `<o s=""N"">Original Sentence</o>`
   - Immediately follow it with its translation wrapped EXACTLY like this: `<t s=""N"">Translated Sentence</t>`
   - Replace 'N' with the sentence number, starting from 1.
2. Maintain ALL original formatting and punctuation within the sentences inside the tags.
3. **CRITICAL:** Your response MUST contain ONLY the sequence of `<o s=""N"">...</o><t s=""N"">...</t>` pairs. Do NOT include ANY introductory text, concluding remarks, explanations, apologies, code fences, or markdown.
4. Do NOT escape `<` or `>` and do NOT wrap output in any container tags.
5. If the input has only one sentence, still output exactly one `<o>` + `<t>` pair.
6. **Natural, idiomatic translation:** Convey meaning and tone in {targetLanguage}, not word-for-word glosses. For idioms, metaphors, and fixed expressions, use the natural equivalent in the target language. Avoid literal calques that sound wrong or shift meaning (e.g. Portuguese ""ganhar o mundo"" in culture/media contexts suggests global breakthrough or worldwide impact—prefer natural English such as ""take the world by storm"", ""make waves internationally"", or ""break through globally""; do not use ""conquer the world"" unless the source clearly implies conquest).

Example Input Text:
Hello world. How are you?

Example Output:
<o s=""1"">Hello world.</o><t s=""1"">Bonjour le monde.</t><o s=""2"">How are you?</o><t s=""2"">Comment allez-vous?</t>

**Text to translate:**
{text}";

            string defaultPlainPrompt = $@"Translate the following sentence or short passage from {sourceLanguage} to {targetLanguage}.
**Strict Instructions:**
1. Return ONLY the translated text in {targetLanguage}.
2. Do NOT include the original text.
3. Do NOT use XML/HTML tags such as `<o>` or `<t>`.
4. Do NOT add explanations, notes, quotes, code fences, or markdown.
5. Preserve meaning, tone, and punctuation naturally in the target language.
6. Translate idiomatically, not word-for-word. Avoid literal calques that sound unnatural or shift meaning.

Text:
{text}";

            string prompt;
            if (includeSentenceTags)
            {
                if (!string.IsNullOrWhiteSpace(customPrompt))
                {
                    _logger.LogInformation("Custom translation prompt provided but tagged-output path requires the structural <o>/<t> template. Ignoring override for full-text translation.");
                }
                prompt = defaultTaggedPrompt;
            }
            else
            {
                var vars = new Dictionary<string, string?>
                {
                    ["text"] = text,
                    ["sourceLanguage"] = sourceLanguage,
                    ["targetLanguage"] = targetLanguage
                };
                prompt = AiTaskConfig.ResolvePromptOrDefault(customPrompt, defaultPlainPrompt, vars, out var unknownTranslationPlaceholders);
                if (unknownTranslationPlaceholders.Count > 0)
                {
                    _logger.LogWarning("Custom translation prompt contains unknown placeholders: {Placeholders}. Known: text, sourceLanguage, targetLanguage.",
                        string.Join(", ", unknownTranslationPlaceholders));
                }
            }

            var request = new ChatCompletionRequest
            {
                Model = model,
                Messages = new[] { new ChatMessage { Role = "user", Content = prompt } },
                Temperature = 0.3,
                MaxTokens = 65535,
                TopP = 1.0
            };
            AiReasoningOptions.ApplyForTranslation(request, connection.Definition.ReasoningStyle, connection.Settings);

            var result = await _chatClient.CompleteAsync(connection, request, "translation");
            if (result.IsExtractionFailure)
            {
                return "Translation failed: Could not extract result";
            }
            if (!result.Success)
            {
                return $"Translation error: {result.Error}";
            }

            _logger.LogInformation("Translation successful using {Provider}, length: {Length}", connection.Definition.DisplayName, result.Content!.Length);
            return result.Content!;
        }

        public async Task<string> TranslateSelectionWithContextAsync(string selectedText, string sentenceContext, string sourceLanguage, string targetLanguage, AiProviderConnection connection)
        {
            if (string.IsNullOrWhiteSpace(selectedText) || string.IsNullOrWhiteSpace(sentenceContext))
            {
                _logger.LogWarning("Empty selected text or sentence context provided for selection translation");
                return string.Empty;
            }

            try
            {
                var finalTargetCode = await ResolveTargetCodeAsync(sourceLanguage, targetLanguage);

                string defaultSelectionPrompt = $@"You are translating only a highlighted span from a sentence.
Source language: {sourceLanguage}
Target language: {finalTargetCode}

Sentence context:
{sentenceContext}

Highlighted text to translate:
{selectedText}

Strict instructions:
1. Translate ONLY the highlighted text, using the sentence context for meaning.
2. Return ONLY the translated highlighted text.
3. Do NOT include the original text, explanations, notes, or formatting.";

                var selectionVars = new Dictionary<string, string?>
                {
                    ["selectedText"] = selectedText,
                    ["sentenceContext"] = sentenceContext,
                    ["sourceLanguage"] = sourceLanguage,
                    ["targetLanguage"] = finalTargetCode,
                    ["text"] = selectedText
                };
                string prompt = AiTaskConfig.ResolvePromptOrDefault(
                    connection.Settings.CustomTranslationPrompt,
                    defaultSelectionPrompt,
                    selectionVars,
                    out var unknownSelectionPlaceholders);
                if (unknownSelectionPlaceholders.Count > 0)
                {
                    _logger.LogWarning("Custom translation prompt (selection path) contains unknown placeholders: {Placeholders}. Known: selectedText, sentenceContext, sourceLanguage, targetLanguage, text.",
                        string.Join(", ", unknownSelectionPlaceholders));
                }

                var request = new ChatCompletionRequest
                {
                    Model = connection.ModelFor(AiTask.Translation),
                    Messages = new[] { new ChatMessage { Role = "user", Content = prompt } },
                    Temperature = 0.2,
                    MaxTokens = 1024,
                    TopP = 1.0
                };
                AiReasoningOptions.ApplyForTranslation(request, connection.Definition.ReasoningStyle, connection.Settings);

                var result = await _chatClient.CompleteAsync(connection, request, "selection translation");
                if (result.IsExtractionFailure) return "Translation failed: Could not extract result";
                return result.Success ? result.Content!.Trim() : $"Translation error: {result.Error}";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during {Provider} selection translation", connection.Definition.DisplayName);
                return $"Translation error: {ex.Message}";
            }
        }
    }
}
