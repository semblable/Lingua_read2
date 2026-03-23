using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using LinguaReadApi.Data;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services
{
    public class OpenRouterTranslationService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<OpenRouterTranslationService> _logger;
        private readonly ILanguageService _languageService;
        private readonly AppDbContext _context;
        private const string BaseUrl = "https://openrouter.ai/api/v1/chat/completions";
        
        // Timeout configuration - 5 minutes for long texts
        private static readonly TimeSpan RequestTimeout = TimeSpan.FromMinutes(5);
        
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
        };
        
        // Default limit for unknown models
        private const int DefaultContextLimit = 30000;
        private static readonly HashSet<string> SupportedReasoningEfforts = new(StringComparer.OrdinalIgnoreCase)
        {
            "xhigh", "high", "medium", "low", "minimal", "none"
        };
        
        // Max characters per chunk (leaves room for prompt overhead)
        private const int MaxCharsPerChunk = 15000;

        public OpenRouterTranslationService(
            ILogger<OpenRouterTranslationService> logger,
            ILanguageService languageService,
            AppDbContext context)
        {
            _httpClient = new HttpClient { Timeout = RequestTimeout };
            _logger = logger;
            _languageService = languageService;
            _context = context;

            _logger.LogInformation("OpenRouterTranslationService initialized with {Timeout}s timeout", RequestTimeout.TotalSeconds);
        }

        public Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage, Guid userId)
        {
            return TranslateAsync(text, sourceLanguage, targetLanguage, userId, includeSentenceTags: false);
        }

        public Task<string> TranslateFullTextAsync(string text, string sourceLanguage, string targetLanguage, Guid userId)
        {
            return TranslateAsync(text, sourceLanguage, targetLanguage, userId, includeSentenceTags: true);
        }

        public Task<string> ExplainSentenceAsync(string text, string sourceLanguage, string targetLanguage, Guid userId)
        {
            return ExplainAsync(text, sourceLanguage, targetLanguage, userId);
        }

        public Task<string> TranslateSelectionWithContextAsync(string selectedText, string sentenceContext, string sourceLanguage, string targetLanguage, Guid userId)
        {
            return TranslateSelectionWithContextInternalAsync(selectedText, sentenceContext, sourceLanguage, targetLanguage, userId);
        }

        private async Task<string> TranslateAsync(string text, string sourceLanguage, string targetLanguage, Guid userId, bool includeSentenceTags)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("Empty text provided for translation");
                return string.Empty;
            }

            try
            {
                // Get user settings for API key and model
                var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
                if (userSettings == null || string.IsNullOrWhiteSpace(userSettings.OpenRouterApiKey))
                {
                    _logger.LogWarning("OpenRouter API key not configured for user {UserId}", userId);
                    return "Translation error: OpenRouter API key not configured";
                }

                var apiKey = userSettings.OpenRouterApiKey;
                var model = userSettings.OpenRouterModel;
                var reasoningOptions = BuildReasoningOptions(userSettings);

                // --- Determine the final target language code ---
                string finalTargetCode = targetLanguage;
                if (!string.IsNullOrEmpty(sourceLanguage))
                {
                    var allLanguages = await _languageService.GetAllLanguagesAsync();
                    var sourceLanguageConfig = allLanguages.FirstOrDefault(l => l.Code.Equals(sourceLanguage, StringComparison.OrdinalIgnoreCase));

                    if (sourceLanguageConfig != null && !string.IsNullOrEmpty(sourceLanguageConfig.GeminiTargetCode))
                    {
                        finalTargetCode = sourceLanguageConfig.GeminiTargetCode;
                        _logger.LogInformation("Using configured target code '{ConfiguredCode}' for source '{SourceCode}'", finalTargetCode, sourceLanguage);
                    }
                }

                // Validate text length against model context
                var contextLimit = GetModelContextLimit(model);
                var estimatedTokens = (int)(text.Length * TokensPerChar);
                
                _logger.LogInformation("Translating text ({Length} chars, ~{Tokens} tokens) from {Source} to {Target} using OpenRouter model {Model} (limit: {Limit}). TaggedOutput={TaggedOutput}",
                    text.Length, estimatedTokens, sourceLanguage, finalTargetCode, model, contextLimit, includeSentenceTags);

                // Check if we need chunking
                if (includeSentenceTags && text.Length > MaxCharsPerChunk)
                {
                    _logger.LogInformation("Text exceeds chunk limit ({Length} > {Limit}), splitting into chunks", text.Length, MaxCharsPerChunk);
                    return await TranslateInChunksAsync(text, sourceLanguage, finalTargetCode, apiKey, model, reasoningOptions);
                }

                // Validate against context limit
                if (estimatedTokens > contextLimit)
                {
                    _logger.LogWarning("Text ({Tokens} tokens) exceeds model context limit ({Limit}). Consider using a larger model.", estimatedTokens, contextLimit);
                    return $"Translation error: Text too long for selected model ({estimatedTokens} tokens > {contextLimit} limit). Try a model with larger context.";
                }

                return await TranslateSingleChunkAsync(text, sourceLanguage, finalTargetCode, apiKey, model, includeSentenceTags, reasoningOptions);
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException || ex.CancellationToken.IsCancellationRequested)
            {
                _logger.LogError(ex, "OpenRouter request timed out after {Timeout}s", RequestTimeout.TotalSeconds);
                return $"Translation error: Request timed out. Text may be too long.";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during OpenRouter translation");
                return $"Translation error: {ex.Message}";
            }
        }

        private async Task<string> ExplainAsync(string text, string sourceLanguage, string targetLanguage, Guid userId)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("Empty text provided for sentence explanation");
                return string.Empty;
            }

            try
            {
                var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
                if (userSettings == null || string.IsNullOrWhiteSpace(userSettings.OpenRouterApiKey))
                {
                    _logger.LogWarning("OpenRouter API key not configured for user {UserId}", userId);
                    return "Explanation error: OpenRouter API key not configured";
                }

                var apiKey = userSettings.OpenRouterApiKey;
                var model = userSettings.OpenRouterModel;
                var reasoningOptions = BuildReasoningOptions(userSettings);
                string explanationLanguage = targetLanguage;

                if (!string.IsNullOrEmpty(sourceLanguage))
                {
                    var allLanguages = await _languageService.GetAllLanguagesAsync();
                    var sourceLanguageConfig = allLanguages.FirstOrDefault(l => l.Code.Equals(sourceLanguage, StringComparison.OrdinalIgnoreCase));
                    if (sourceLanguageConfig != null && !string.IsNullOrEmpty(sourceLanguageConfig.GeminiTargetCode))
                    {
                        explanationLanguage = sourceLanguageConfig.GeminiTargetCode;
                    }
                }

                string prompt = SentenceExplanationPrompt.Build(text, sourceLanguage, explanationLanguage);

                var requestPayload = new OpenRouterRequest
                {
                    Model = model,
                    Messages = new[]
                    {
                        new OpenRouterMessage
                        {
                            Role = "user",
                            Content = prompt
                        }
                    },
                    Temperature = 0.3,
                    MaxTokens = 65535,
                    TopP = 1.0,
                    Reasoning = reasoningOptions
                };

                var options = new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = false
                };

                string jsonPayload = JsonSerializer.Serialize(requestPayload, options);
                const int maxAttempts = 3;
                HttpStatusCode? lastStatus = null;

                for (int attempt = 1; attempt <= maxAttempts; attempt++)
                {
                    var request = new HttpRequestMessage(HttpMethod.Post, BaseUrl);
                    request.Headers.Add("Authorization", $"Bearer {apiKey}");
                    request.Headers.Add("HTTP-Referer", "https://lingua-read.app");
                    request.Headers.Add("X-Title", "Lingua-Read");
                    request.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

                    var response = await _httpClient.SendAsync(request);
                    var responseContent = await response.Content.ReadAsStringAsync();

                    if (!response.IsSuccessStatusCode)
                    {
                        lastStatus = response.StatusCode;
                        var isRetryable = response.StatusCode == HttpStatusCode.ServiceUnavailable ||
                                          response.StatusCode == HttpStatusCode.TooManyRequests;

                        if (isRetryable && attempt < maxAttempts)
                        {
                            var delayMs = (int)Math.Pow(2, attempt - 1) * 1000;
                            await Task.Delay(delayMs);
                            continue;
                        }

                        return $"Explanation error: {response.StatusCode}";
                    }

                    var openRouterResponse = JsonSerializer.Deserialize<OpenRouterResponse>(responseContent, options);
                    if (openRouterResponse?.Error != null)
                    {
                        return $"Explanation error: {openRouterResponse.Error.Message}";
                    }

                    if (openRouterResponse?.Choices != null &&
                        openRouterResponse.Choices.Length > 0 &&
                        openRouterResponse.Choices[0].Message?.Content != null)
                    {
                        return openRouterResponse.Choices[0].Message!.Content;
                    }

                    return "Explanation failed: Could not extract result";
                }

                return $"Explanation error: {lastStatus}";
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException || ex.CancellationToken.IsCancellationRequested)
            {
                _logger.LogError(ex, "OpenRouter sentence explanation timed out after {Timeout}s", RequestTimeout.TotalSeconds);
                return "Explanation error: Request timed out.";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during OpenRouter sentence explanation");
                return $"Explanation error: {ex.Message}";
            }
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

        private async Task<string> TranslateInChunksAsync(string text, string sourceLanguage, string targetLanguage, string apiKey, string model, OpenRouterReasoningOptions? reasoningOptions)
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
                
                var result = await TranslateSingleChunkAsync(chunk, sourceLanguage, targetLanguage, apiKey, model, includeSentenceTags: true, reasoningOptions);
                
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

        private async Task<string> TranslateSingleChunkAsync(string text, string sourceLanguage, string targetLanguage, string apiKey, string model, bool includeSentenceTags, OpenRouterReasoningOptions? reasoningOptions)
        {
            string prompt = includeSentenceTags
                ? $@"Translate the following text from {sourceLanguage} to {targetLanguage}, sentence by sentence.
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
{text}"
                : $@"Translate the following sentence or short passage from {sourceLanguage} to {targetLanguage}.
**Strict Instructions:**
1. Return ONLY the translated text in {targetLanguage}.
2. Do NOT include the original text.
3. Do NOT use XML/HTML tags such as `<o>` or `<t>`.
4. Do NOT add explanations, notes, quotes, code fences, or markdown.
5. Preserve meaning, tone, and punctuation naturally in the target language.
6. Translate idiomatically, not word-for-word. Avoid literal calques that sound unnatural or shift meaning.

Text:
{text}";

            // Create OpenRouter request
            var requestPayload = new OpenRouterRequest
            {
                Model = model,
                Messages = new[]
                {
                    new OpenRouterMessage
                    {
                        Role = "user",
                        Content = prompt
                    }
                },
                Temperature = 0.3,
                MaxTokens = 65535,
                TopP = 1.0,
                Reasoning = reasoningOptions
            };

            var options = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                WriteIndented = false
            };

            string jsonPayload = JsonSerializer.Serialize(requestPayload, options);
            _logger.LogDebug("OpenRouter request payload: {Payload}", jsonPayload.Substring(0, Math.Min(500, jsonPayload.Length)));

            // Send request with retries
            const int maxAttempts = 3;
            HttpStatusCode? lastStatus = null;

            for (int attempt = 1; attempt <= maxAttempts; attempt++)
            {
                var request = new HttpRequestMessage(HttpMethod.Post, BaseUrl);
                request.Headers.Add("Authorization", $"Bearer {apiKey}");
                request.Headers.Add("HTTP-Referer", "https://lingua-read.app");
                request.Headers.Add("X-Title", "Lingua-Read");
                request.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

                var response = await _httpClient.SendAsync(request);
                var responseContent = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    lastStatus = response.StatusCode;
                    var isRetryable = response.StatusCode == HttpStatusCode.ServiceUnavailable ||
                                      response.StatusCode == HttpStatusCode.TooManyRequests;

                    _logger.LogWarning("OpenRouter API error (attempt={Attempt}/{Max}): {StatusCode}. Retryable={Retryable}. Response={Response}",
                        attempt, maxAttempts, response.StatusCode, isRetryable, responseContent);

                    if (isRetryable && attempt < maxAttempts)
                    {
                        var delayMs = (int)Math.Pow(2, attempt - 1) * 1000;
                        await Task.Delay(delayMs);
                        continue;
                    }

                    return $"Translation error: {response.StatusCode}";
                }

                _logger.LogDebug("OpenRouter API response: {Response}", responseContent.Substring(0, Math.Min(500, responseContent.Length)));

                var openRouterResponse = JsonSerializer.Deserialize<OpenRouterResponse>(responseContent, options);

                if (openRouterResponse?.Error != null)
                {
                    _logger.LogWarning("OpenRouter API returned error: {Error}", openRouterResponse.Error.Message);
                    return $"Translation error: {openRouterResponse.Error.Message}";
                }

                if (openRouterResponse?.Choices != null &&
                    openRouterResponse.Choices.Length > 0 &&
                    openRouterResponse.Choices[0].Message?.Content != null)
                {
                    var translatedText = openRouterResponse.Choices[0].Message!.Content;
                    _logger.LogInformation("Translation successful using OpenRouter, length: {Length}", translatedText.Length);
                    return translatedText;
                }

                _logger.LogWarning("Could not extract translation from OpenRouter response");
                return "Translation failed: Could not extract result";
            }

            return $"Translation error: {lastStatus}";
        }

        private async Task<string> TranslateSelectionWithContextInternalAsync(string selectedText, string sentenceContext, string sourceLanguage, string targetLanguage, Guid userId)
        {
            if (string.IsNullOrWhiteSpace(selectedText) || string.IsNullOrWhiteSpace(sentenceContext))
            {
                _logger.LogWarning("Empty selected text or sentence context provided for selection translation");
                return string.Empty;
            }

            try
            {
                var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
                if (userSettings == null || string.IsNullOrWhiteSpace(userSettings.OpenRouterApiKey))
                {
                    _logger.LogWarning("OpenRouter API key not configured for user {UserId}", userId);
                    return "Translation error: OpenRouter API key not configured";
                }

                var apiKey = userSettings.OpenRouterApiKey;
                var model = userSettings.OpenRouterModel;
                var reasoningOptions = BuildReasoningOptions(userSettings);
                string finalTargetCode = targetLanguage;

                if (!string.IsNullOrEmpty(sourceLanguage))
                {
                    var allLanguages = await _languageService.GetAllLanguagesAsync();
                    var sourceLanguageConfig = allLanguages.FirstOrDefault(l => l.Code.Equals(sourceLanguage, StringComparison.OrdinalIgnoreCase));
                    if (sourceLanguageConfig != null && !string.IsNullOrEmpty(sourceLanguageConfig.GeminiTargetCode))
                    {
                        finalTargetCode = sourceLanguageConfig.GeminiTargetCode;
                    }
                }

                string prompt = $@"You are translating only a highlighted span from a sentence.
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

                var requestPayload = new OpenRouterRequest
                {
                    Model = model,
                    Messages = new[]
                    {
                        new OpenRouterMessage
                        {
                            Role = "user",
                            Content = prompt
                        }
                    },
                    Temperature = 0.2,
                    MaxTokens = 1024,
                    TopP = 1.0,
                    Reasoning = reasoningOptions
                };

                var options = new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = false
                };

                string jsonPayload = JsonSerializer.Serialize(requestPayload, options);
                const int maxAttempts = 3;
                HttpStatusCode? lastStatus = null;

                for (int attempt = 1; attempt <= maxAttempts; attempt++)
                {
                    var request = new HttpRequestMessage(HttpMethod.Post, BaseUrl);
                    request.Headers.Add("Authorization", $"Bearer {apiKey}");
                    request.Headers.Add("HTTP-Referer", "https://lingua-read.app");
                    request.Headers.Add("X-Title", "Lingua-Read");
                    request.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

                    var response = await _httpClient.SendAsync(request);
                    var responseContent = await response.Content.ReadAsStringAsync();

                    if (!response.IsSuccessStatusCode)
                    {
                        lastStatus = response.StatusCode;
                        var isRetryable = response.StatusCode == HttpStatusCode.ServiceUnavailable ||
                                          response.StatusCode == HttpStatusCode.TooManyRequests;
                        if (isRetryable && attempt < maxAttempts)
                        {
                            var delayMs = (int)Math.Pow(2, attempt - 1) * 1000;
                            await Task.Delay(delayMs);
                            continue;
                        }

                        return $"Translation error: {response.StatusCode}";
                    }

                    var openRouterResponse = JsonSerializer.Deserialize<OpenRouterResponse>(responseContent, options);
                    if (openRouterResponse?.Error != null)
                    {
                        return $"Translation error: {openRouterResponse.Error.Message}";
                    }

                    if (openRouterResponse?.Choices != null &&
                        openRouterResponse.Choices.Length > 0 &&
                        openRouterResponse.Choices[0].Message?.Content != null)
                    {
                        return openRouterResponse.Choices[0].Message!.Content.Trim();
                    }

                    return "Translation failed: Could not extract result";
                }

                return $"Translation error: {lastStatus}";
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException || ex.CancellationToken.IsCancellationRequested)
            {
                _logger.LogError(ex, "OpenRouter selection translation timed out after {Timeout}s", RequestTimeout.TotalSeconds);
                return "Translation error: Request timed out.";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during OpenRouter selection translation");
                return $"Translation error: {ex.Message}";
            }
        }

        private static OpenRouterReasoningOptions? BuildReasoningOptions(Models.UserSettings userSettings)
        {
            if (!userSettings.OpenRouterReasoningEnabled)
            {
                return null;
            }

            var effort = (userSettings.OpenRouterReasoningEffort ?? string.Empty).Trim().ToLowerInvariant();
            if (!SupportedReasoningEfforts.Contains(effort))
            {
                effort = "medium";
            }

            return new OpenRouterReasoningOptions
            {
                Enabled = true,
                Effort = effort
            };
        }
    }
}
