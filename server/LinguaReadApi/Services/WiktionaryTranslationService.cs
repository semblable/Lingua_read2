using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    /// <summary>
    /// Word-level translation backed by Wiktionary instead of DeepL. Implements the same
    /// <see cref="ITranslationService"/> contract by flattening dictionary definitions into a
    /// single gloss string, so it is a drop-in replacement everywhere DeepL is used today.
    ///
    /// Uses the English Wiktionary REST definition endpoint
    /// (<c>{BaseUrl}/api/rest_v1/page/definition/{term}</c>), which returns definitions for a
    /// word in many source languages, written in English. Because that structured endpoint is
    /// English-Wiktionary-only (other editions return HTTP 501), glosses are always English and
    /// <paramref name="targetLang"/> is currently ignored.
    ///
    /// Extension point for non-English targets: map the target language to a different edition
    /// base URL and add a per-edition wikitext parser (the REST endpoint will not be available
    /// there). See <see cref="ResolveLanguageKey"/> for source-language handling.
    /// </summary>
    public class WiktionaryTranslationService : ITranslationService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<WiktionaryTranslationService> _logger;
        private readonly string _baseUrl;
        private readonly string _userAgent;
        // Server-level OAuth 2.0 token from config (env/appsettings). Used as the fallback when
        // a user has not set their own token. Null = none.
        private readonly string? _configAccessToken;
        // Effective token for the current (scoped) request: a per-user token applied via
        // UseAccessToken overrides the config token. When set, requests are authenticated, which
        // raises the Wikimedia REST limit from <5 req/s (anonymous) to 10 req/s. Null = anonymous.
        private string? _accessToken;

        // Wikimedia's User-Agent policy requires contact info (a URL or email); a bare app name
        // can be throttled or blocked. Override via config with your own contact.
        private const string DefaultUserAgent = "LinguaRead/1.0 (https://github.com/semblable/Lingua_read2)";
        // Sentinel used elsewhere in appsettings.json for secrets supplied via dotenv; treat it
        // as "unset" so an unconfigured install still works anonymously.
        private const string UnsetSecretSentinel = "SET_IN_DOTENV";
        // Keep glosses short; a clicked word does not need every sense.
        private const int MaxSensesPerGloss = 3;
        // Politeness / latency cap when fanning a batch out into individual requests. Wikimedia's
        // anonymous REST guidance is 3 or fewer concurrent requests; authenticating does not lift
        // the concurrency advice, so keep this at 3 regardless of token.
        private const int MaxConcurrentRequests = 3;
        // Wiktionary has no batch endpoint, so a batch becomes one upstream request per word — all
        // from the server's single shared IP. Cap the fan-out per call so a very large
        // auto-translate-on-open can't hammer Wikimedia into rate-limiting (or blocking) the whole
        // instance, and to bound latency. Words past the cap are left untranslated (same as a
        // not-found), which the reader already handles gracefully.
        private const int MaxBatchLookups = 200;
        // On HTTP 429 we honor Retry-After once, but never wait longer than this — a clicked
        // word should fail fast rather than hang. Used as the fallback delay when the header
        // is absent.
        private static readonly TimeSpan MaxRetryAfter = TimeSpan.FromSeconds(5);
        private static readonly TimeSpan DefaultRetryAfter = TimeSpan.FromSeconds(1);

        private static readonly Regex HtmlTagRegex = new("<[^>]+>", RegexOptions.Compiled);
        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        public WiktionaryTranslationService(
            HttpClient httpClient,
            IConfiguration configuration,
            ILogger<WiktionaryTranslationService> logger)
        {
            _httpClient = httpClient;
            _logger = logger;
            _baseUrl = (configuration["Wiktionary:BaseUrl"] ?? "https://en.wiktionary.org").TrimEnd('/');
            _userAgent = configuration["Wiktionary:UserAgent"] ?? DefaultUserAgent;

            _configAccessToken = NormalizeToken(configuration["Wiktionary:AccessToken"]);
            _accessToken = _configAccessToken;
        }

        /// <summary>
        /// Applies a per-user access token for the current (scoped) request, overriding the
        /// server-level config token. A null/blank/placeholder value falls back to the config
        /// token (which may itself be null = anonymous). Called by the word-translation factory
        /// so each user authenticates with their own token.
        /// </summary>
        public void UseAccessToken(string? token)
        {
            _accessToken = NormalizeToken(token) ?? _configAccessToken;
        }

        // Treats blank values and the dotenv sentinel as "unset" so an unconfigured token never
        // produces a bogus "Bearer SET_IN_DOTENV" header.
        private static string? NormalizeToken(string? token) =>
            string.IsNullOrWhiteSpace(token) || token == UnsetSecretSentinel ? null : token.Trim();

        public async Task<string> TranslateTextAsync(string text, string? sourceLang, string targetLang)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return string.Empty;
            }

            // CancellationToken.None: the ITranslationService contract carries no token, and
            // single-word lookups are bounded by the HttpClient timeout anyway.
            var entries = await FetchEntriesAsync(text.Trim(), sourceLang, CancellationToken.None);
            return BuildGloss(entries);
        }

        public async Task<Dictionary<string, string>> TranslateBatchAsync(List<string> words, string targetLang, string? sourceLang = null)
        {
            var translations = new Dictionary<string, string>();
            if (words == null || words.Count == 0)
            {
                return translations;
            }

            // Wiktionary has no batch endpoint, so issue per-word requests with a bounded
            // concurrency to stay polite and avoid rate limiting on auto-translate-on-open.
            using var gate = new SemaphoreSlim(MaxConcurrentRequests);
            // If any word gets rate-limited, cancel the in-flight siblings and surface a single
            // rate-limit error rather than silently returning a half-empty batch.
            using var cts = new CancellationTokenSource();
            var rateLimited = 0;
            var distinctWords = words.Where(w => !string.IsNullOrWhiteSpace(w)).Distinct().ToList();
            if (distinctWords.Count > MaxBatchLookups)
            {
                _logger.LogWarning(
                    "Wiktionary batch has {Count} words, above the per-request cap of {Cap}; the extra words are skipped.",
                    distinctWords.Count, MaxBatchLookups);
                distinctWords = distinctWords.Take(MaxBatchLookups).ToList();
            }

            var lookups = distinctWords.Select(async word =>
            {
                await gate.WaitAsync();
                try
                {
                    var entries = await FetchEntriesAsync(word, sourceLang, cts.Token);
                    return (word, gloss: (string?)BuildGloss(entries));
                }
                catch (WiktionaryRateLimitException)
                {
                    Interlocked.Exchange(ref rateLimited, 1);
                    cts.Cancel();
                    return (word, gloss: null);
                }
                catch (OperationCanceledException)
                {
                    return (word, gloss: null);
                }
                finally
                {
                    gate.Release();
                }
            });

            var results = await Task.WhenAll(lookups);

            if (Volatile.Read(ref rateLimited) == 1)
            {
                throw new WiktionaryRateLimitException();
            }

            foreach (var (word, gloss) in results)
            {
                translations[word] = gloss ?? string.Empty;
            }

            return translations;
        }

        /// <summary>
        /// Returns structured definitions (part of speech + senses) for the optional rich
        /// display, or an empty list when the word is not found.
        /// </summary>
        public async Task<IReadOnlyList<WordDefinitionEntry>> GetDefinitionsAsync(string term, string? sourceLang)
        {
            if (string.IsNullOrWhiteSpace(term))
            {
                return Array.Empty<WordDefinitionEntry>();
            }

            // CancellationToken.None: see TranslateTextAsync — no token in the calling contract.
            var entries = await FetchEntriesAsync(term.Trim(), sourceLang, CancellationToken.None);
            return entries
                .Select(e => new WordDefinitionEntry
                {
                    PartOfSpeech = e.PartOfSpeech ?? string.Empty,
                    Senses = (e.Definitions ?? new List<WiktionaryDefinition>())
                        .Select(d => StripHtml(d.Definition))
                        .Where(s => !string.IsNullOrWhiteSpace(s))
                        .Select(s => new WordSense { Definition = s })
                        .ToList()
                })
                .Where(e => e.Senses.Count > 0)
                .ToList();
        }

        private async Task<IReadOnlyList<WiktionaryEntry>> FetchEntriesAsync(string term, string? sourceLang, CancellationToken ct)
        {
            // Wiktionary page titles are case-sensitive: try the surface form first, then a
            // lower-cased fallback (covers common nouns/verbs that are not capitalized).
            // A WiktionaryRateLimitException from TryFetchAsync propagates out (not swallowed)
            // so the controller can surface an HTTP 429.
            var response = await TryFetchAsync(term, ct);
            if (response == null && term != term.ToLowerInvariant())
            {
                response = await TryFetchAsync(term.ToLowerInvariant(), ct);
            }

            if (response == null)
            {
                return Array.Empty<WiktionaryEntry>();
            }

            var languageKey = ResolveLanguageKey(response, sourceLang);
            if (languageKey == null || !response.TryGetValue(languageKey, out var entries) || entries == null)
            {
                return Array.Empty<WiktionaryEntry>();
            }

            return entries;
        }

        // Returns the parsed response, null when the word is absent (404) or on a non-retryable
        // error, and throws <see cref="WiktionaryRateLimitException"/> when the endpoint stays
        // rate-limited (HTTP 429) after a single Retry-After-bounded retry.
        private async Task<Dictionary<string, List<WiktionaryEntry>>?> TryFetchAsync(string term, CancellationToken ct)
        {
            var url = $"{_baseUrl}/api/rest_v1/page/definition/{Uri.EscapeDataString(term)}";

            // attempt 0 = initial request, attempt 1 = the single Retry-After-bounded retry.
            for (var attempt = 0; attempt < 2; attempt++)
            {
                try
                {
                    using var request = new HttpRequestMessage(HttpMethod.Get, url);
                    request.Headers.TryAddWithoutValidation("User-Agent", _userAgent);
                    request.Headers.TryAddWithoutValidation("Accept", "application/json");
                    if (_accessToken != null)
                    {
                        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _accessToken);
                    }

                    using var response = await _httpClient.SendAsync(request, ct);

                    if (response.StatusCode == HttpStatusCode.NotFound)
                    {
                        return null;
                    }

                    if (response.StatusCode == HttpStatusCode.TooManyRequests)
                    {
                        var retryAfter = GetRetryAfterDelay(response);
                        if (attempt == 0 && retryAfter <= MaxRetryAfter)
                        {
                            _logger.LogWarning("Wiktionary rate-limited '{Term}'; retrying after {Delay}.", term, retryAfter);
                            await Task.Delay(retryAfter, ct);
                            continue;
                        }
                        // Out of retries (or asked to wait too long) — surface to the caller.
                        throw new WiktionaryRateLimitException();
                    }

                    if (!response.IsSuccessStatusCode)
                    {
                        _logger.LogWarning("Wiktionary lookup for '{Term}' failed with status {Status}.", term, response.StatusCode);
                        return null;
                    }

                    return await response.Content.ReadFromJsonAsync<Dictionary<string, List<WiktionaryEntry>>>(JsonOptions, ct);
                }
                catch (WiktionaryRateLimitException)
                {
                    throw;
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    // A sibling lookup in the batch hit a rate limit and cancelled the rest.
                    throw;
                }
                catch (Exception ex)
                {
                    // Degrade to "no translation" rather than surfacing a 500, matching DeepL's
                    // behaviour. This also covers an HTTP client timeout (OperationCanceledException
                    // not triggered by our own token).
                    _logger.LogError(ex, "Error calling Wiktionary for term '{Term}'.", term);
                    return null;
                }
            }

            // Unreachable in practice (attempt 1 with a 429 throws above), but keeps the
            // compiler happy that every path returns or throws.
            throw new WiktionaryRateLimitException();
        }

        private static TimeSpan GetRetryAfterDelay(HttpResponseMessage response)
        {
            var retryAfter = response.Headers.RetryAfter;
            if (retryAfter != null)
            {
                if (retryAfter.Delta.HasValue)
                {
                    return retryAfter.Delta.Value < TimeSpan.Zero ? TimeSpan.Zero : retryAfter.Delta.Value;
                }
                if (retryAfter.Date.HasValue)
                {
                    var delta = retryAfter.Date.Value - DateTimeOffset.UtcNow;
                    return delta < TimeSpan.Zero ? TimeSpan.Zero : delta;
                }
            }
            return DefaultRetryAfter;
        }

        /// <summary>
        /// Picks the response key matching the source language (e.g. "fr"), falling back to the
        /// first concrete language, then Wiktionary's "other" bucket.
        /// </summary>
        private static string? ResolveLanguageKey(Dictionary<string, List<WiktionaryEntry>> response, string? sourceLang)
        {
            if (response.Count == 0)
            {
                return null;
            }

            if (!string.IsNullOrWhiteSpace(sourceLang))
            {
                // App codes can carry a region (e.g. "fr-CA"); Wiktionary keys are bare ISO codes.
                var normalized = sourceLang.Trim().ToLowerInvariant().Split('-')[0];
                var match = response.Keys.FirstOrDefault(k => k.Equals(normalized, StringComparison.OrdinalIgnoreCase));
                if (match != null)
                {
                    return match;
                }
            }

            return response.Keys.FirstOrDefault(k => !k.Equals("other", StringComparison.OrdinalIgnoreCase))
                   ?? response.Keys.First();
        }

        private static string BuildGloss(IReadOnlyList<WiktionaryEntry> entries)
        {
            var senses = entries
                .SelectMany(e => e.Definitions ?? new List<WiktionaryDefinition>())
                .Select(d => StripHtml(d.Definition))
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Take(MaxSensesPerGloss);

            return string.Join("; ", senses);
        }

        private static string StripHtml(string? html)
        {
            if (string.IsNullOrWhiteSpace(html))
            {
                return string.Empty;
            }

            var withoutTags = HtmlTagRegex.Replace(html, string.Empty);
            return WebUtility.HtmlDecode(withoutTags).Trim();
        }
    }

    // --- Wiktionary REST response shape (definitions keyed by language code) ---

    public class WiktionaryEntry
    {
        [JsonPropertyName("partOfSpeech")]
        public string? PartOfSpeech { get; set; }

        [JsonPropertyName("language")]
        public string? Language { get; set; }

        [JsonPropertyName("definitions")]
        public List<WiktionaryDefinition>? Definitions { get; set; }
    }

    public class WiktionaryDefinition
    {
        [JsonPropertyName("definition")]
        public string? Definition { get; set; }
    }

    // --- Structured result for the optional rich display ---

    public class WordDefinitionEntry
    {
        public string PartOfSpeech { get; set; } = string.Empty;
        public List<WordSense> Senses { get; set; } = new();
    }

    public class WordSense
    {
        public string Definition { get; set; } = string.Empty;
    }

    /// <summary>
    /// Thrown when the Wiktionary endpoint stays rate-limited (HTTP 429) after a single
    /// Retry-After-bounded retry. The controller maps this to HTTP 429 so the reader shows
    /// its existing "rate limit reached" message.
    /// </summary>
    public class WiktionaryRateLimitException : Exception
    {
        public WiktionaryRateLimitException()
            : base("Wiktionary rate limit reached.") { }
    }
}
