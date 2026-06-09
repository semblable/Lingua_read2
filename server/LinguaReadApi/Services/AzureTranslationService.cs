using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    /// <summary>
    /// Word-level translation backed by the Azure AI Translator REST API (v3.0). Implements the
    /// shared <see cref="ITranslationService"/> contract so it is a drop-in alternative to DeepL
    /// for single-word and batch lookups.
    ///
    /// Credentials are per-user (applied via <see cref="UseCredentials"/> by the word-translation
    /// factory), falling back to the server-level <c>Azure:Translator:*</c> config. A global Azure
    /// Translator resource needs only a key; a regional resource also needs its region for the
    /// <c>Ocp-Apim-Subscription-Region</c> header.
    /// </summary>
    public class AzureTranslationService : ITranslationService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<AzureTranslationService> _logger;
        private readonly string _endpoint;
        // Server-level credentials from config (env/appsettings); used as the fallback when a user
        // has not set their own. Null = none.
        private readonly string? _configKey;
        private readonly string? _configRegion;
        // Effective credentials for the current (scoped) request: a per-user value applied via
        // UseCredentials overrides config. Null key = unconfigured (lookups return empty).
        private string? _key;
        private string? _region;

        // Sentinel used elsewhere in appsettings.json for secrets supplied via dotenv; treat it as
        // "unset" so an unconfigured install does not send a bogus key.
        private const string UnsetSecretSentinel = "SET_IN_DOTENV";
        // Azure caps a request at 1000 array elements / 50k chars. Words are short, so chunk by
        // count to stay well within limits during auto-translate-on-open.
        private const int MaxItemsPerRequest = 100;

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        public AzureTranslationService(
            HttpClient httpClient,
            IConfiguration configuration,
            ILogger<AzureTranslationService> logger)
        {
            _httpClient = httpClient;
            _logger = logger;
            _endpoint = (configuration["Azure:Translator:Endpoint"] ?? "https://api.cognitive.microsofttranslator.com").TrimEnd('/');
            _configKey = NormalizeSecret(configuration["Azure:Translator:Key"]);
            _configRegion = NormalizeSecret(configuration["Azure:Translator:Region"]);
            _key = _configKey;
            _region = _configRegion;
        }

        /// <summary>
        /// Applies per-user credentials for the current (scoped) request, overriding the
        /// server-level config. Null/blank/placeholder values fall back to the config credentials.
        /// </summary>
        public void UseCredentials(string? key, string? region)
        {
            _key = NormalizeSecret(key) ?? _configKey;
            _region = NormalizeSecret(region) ?? _configRegion;
        }

        // Treats blank values and the dotenv sentinel as "unset".
        private static string? NormalizeSecret(string? value) =>
            string.IsNullOrWhiteSpace(value) || value == UnsetSecretSentinel ? null : value.Trim();

        public async Task<string> TranslateTextAsync(string text, string? sourceLang, string targetLang)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return string.Empty;
            }

            var batch = await TranslateBatchAsync(new List<string> { text }, targetLang, sourceLang);
            return batch.Values.FirstOrDefault() ?? string.Empty;
        }

        public async Task<Dictionary<string, string>> TranslateBatchAsync(List<string> words, string targetLang, string? sourceLang = null)
        {
            var translations = new Dictionary<string, string>();
            if (words == null || words.Count == 0)
            {
                return translations;
            }

            if (_key == null)
            {
                _logger.LogWarning("Azure Translator key is not configured; returning no translations.");
                return translations;
            }

            // Normalise to bare lowercase codes (Azure accepts BCP-47, but lowercase ISO is safe
            // for the app's target codes like "EN").
            var to = targetLang.Trim().ToLowerInvariant();
            var from = string.IsNullOrWhiteSpace(sourceLang) ? null : sourceLang.Trim().ToLowerInvariant();

            var distinctWords = words.Where(w => !string.IsNullOrWhiteSpace(w)).Distinct().ToList();

            foreach (var chunk in Chunk(distinctWords, MaxItemsPerRequest))
            {
                try
                {
                    var url = $"{_endpoint}/translate?api-version=3.0&to={Uri.EscapeDataString(to)}";
                    if (from != null)
                    {
                        url += $"&from={Uri.EscapeDataString(from)}";
                    }

                    var payload = chunk.Select(w => new AzureTextInput { Text = w }).ToList();
                    using var request = new HttpRequestMessage(HttpMethod.Post, url)
                    {
                        Content = JsonContent.Create(payload)
                    };
                    request.Headers.TryAddWithoutValidation("Ocp-Apim-Subscription-Key", _key);
                    if (_region != null)
                    {
                        request.Headers.TryAddWithoutValidation("Ocp-Apim-Subscription-Region", _region);
                    }

                    using var response = await _httpClient.SendAsync(request);
                    if (!response.IsSuccessStatusCode)
                    {
                        var errorContent = await response.Content.ReadAsStringAsync();
                        _logger.LogError("Azure Translator request failed with status {Status}: {Error}", response.StatusCode, errorContent);
                        continue;
                    }

                    var results = await response.Content.ReadFromJsonAsync<List<AzureTranslationResult>>(JsonOptions);
                    if (results == null || results.Count != chunk.Count)
                    {
                        _logger.LogWarning("Azure Translator response count mismatch (expected {Expected}, got {Got}).", chunk.Count, results?.Count ?? 0);
                        continue;
                    }

                    // Azure preserves input order, so zip the chunk with its results.
                    for (var i = 0; i < chunk.Count; i++)
                    {
                        var translated = results[i].Translations?.FirstOrDefault()?.Text ?? string.Empty;
                        translations[chunk[i]] = translated;
                    }
                }
                catch (Exception ex)
                {
                    // Degrade to "no translation" rather than surfacing a 500, matching DeepL.
                    _logger.LogError(ex, "Error occurred while calling the Azure Translator API.");
                }
            }

            return translations;
        }

        private static IEnumerable<List<T>> Chunk<T>(List<T> source, int size)
        {
            for (var i = 0; i < source.Count; i += size)
            {
                yield return source.GetRange(i, Math.Min(size, source.Count - i));
            }
        }
    }

    // --- Azure Translator request/response shapes ---

    public class AzureTextInput
    {
        [JsonPropertyName("Text")]
        public string Text { get; set; } = string.Empty;
    }

    public class AzureTranslationResult
    {
        [JsonPropertyName("translations")]
        public List<AzureTranslation>? Translations { get; set; }
    }

    public class AzureTranslation
    {
        [JsonPropertyName("text")]
        public string? Text { get; set; }

        [JsonPropertyName("to")]
        public string? To { get; set; }
    }
}
