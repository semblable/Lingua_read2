using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Utilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LinguaReadApi.Services;

public interface IHardcoverService
{
    Task<HardcoverConnectionResult> GetStatusAsync(Guid userId, CancellationToken cancellationToken = default);
    Task<HardcoverMatchResult> MatchBookAsync(
        Guid userId,
        int bookId,
        int? hardcoverBookId = null,
        int? hardcoverEditionId = null,
        string? searchQuery = null,
        CancellationToken cancellationToken = default);
    Task UnlinkBookAsync(Guid userId, int bookId, CancellationToken cancellationToken = default);
    Task<HardcoverMetadataImportResult> ImportMetadataAsync(Guid userId, int bookId, CancellationToken cancellationToken = default);
    Task<HardcoverProgressSyncResult> SyncProgressAsync(Guid userId, int bookId, bool requireSyncEnabled = false, decimal? rating = null, CancellationToken cancellationToken = default);
    Task<HardcoverSyncAllResult> SyncAllAsync(Guid userId, CancellationToken cancellationToken = default);
}

public sealed class HardcoverConfigurationException : InvalidOperationException
{
    public HardcoverConfigurationException(string message) : base(message) { }
}

public sealed class HardcoverBookNotFoundException(string message) : KeyNotFoundException(message);

public sealed class HardcoverConflictException(string message) : InvalidOperationException(message);

public sealed class HardcoverApiException : InvalidOperationException
{
    public HttpStatusCode? StatusCode { get; }
    public string? ErrorCode { get; }
    public string? MissingScope { get; }
    public int? RetryAfterSeconds { get; }

    public HardcoverApiException(
        string message,
        HttpStatusCode? statusCode = null,
        string? errorCode = null,
        string? missingScope = null,
        int? retryAfterSeconds = null,
        Exception? innerException = null)
        : base(message, innerException)
    {
        StatusCode = statusCode;
        ErrorCode = errorCode;
        MissingScope = missingScope;
        RetryAfterSeconds = retryAfterSeconds;
    }
}

public sealed class HardcoverService : IHardcoverService
{
    public const string ApiClientName = "HardcoverApi";
    public const string UserAgent = "LinguaRead/1.0 (https://github.com/semblable/Lingua_read2)";

    private const string Endpoint = "https://api.hardcover.app/v1/graphql";
    private const int WantToReadStatus = 1;
    private const int CurrentlyReadingStatus = 2;
    private const int ReadStatus = 3;
    private const double AutoMatchThreshold = 0.92;
    private const int MaxCoverBytes = 5 * 1024 * 1024;
    private const int MaxRateLimitWaitSeconds = 15;
    private const int MetadataBatchSize = 50;
    private const int LibraryBatchSize = 100;
    private const string DuplicateHardcoverBookMessage = "Another book in your library is already linked to this Hardcover book.";
    private const string UnlinkedBookMessage = "This book was unlinked from Hardcover. Choose a match to link it again.";
    private const string RereadSyncPaused = "Hardcover progress sync resumes when this reread is finished.";

    private static readonly HashSet<string> AuthorNameParticles = new(StringComparer.Ordinal)
    {
        "de", "da", "del", "la", "le", "el", "van", "von", "di", "du", "al", "st"
    };

    private static readonly Regex HardcoverIdUrlRegex = new(
        @"(?:^|hardcover\.app)/id/books?/(\d+)(?:[/?#]|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex HardcoverBookSlugUrlRegex = new(
        @"hardcover\.app/books/([^/?#]+)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly AppDbContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<HardcoverService> _logger;
    private readonly bool _externalWritesDisabled;
    private readonly HardcoverRateLimiter _rateLimiter;
    private readonly HardcoverOperationLock _operationLock;

    internal Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;
    internal Func<DateTimeOffset> UtcNow { get; set; } = () => DateTimeOffset.UtcNow;
    internal TimeSpan CoverDownloadTimeout { get; set; } = TimeSpan.FromSeconds(20);

    public HardcoverService(
        AppDbContext context,
        IHttpClientFactory httpClientFactory,
        IWebHostEnvironment environment,
        ILogger<HardcoverService> logger,
        IOptions<ExternalWritesOptions>? externalWrites = null,
        HardcoverRateLimiter? rateLimiter = null,
        HardcoverOperationLock? operationLock = null)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _environment = environment;
        _logger = logger;
        _externalWritesDisabled = externalWrites?.Value.Disabled ?? false;
        _rateLimiter = rateLimiter ?? new HardcoverRateLimiter();
        _operationLock = operationLock ?? new HardcoverOperationLock();
    }

    public async Task<HardcoverConnectionResult> GetStatusAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var settings = await GetSettingsAsync(userId, cancellationToken);
        if (string.IsNullOrWhiteSpace(settings?.HardcoverApiToken))
        {
            return new HardcoverConnectionResult(false, false, settings?.HardcoverSyncEnabled ?? false, null, null, "Hardcover API token is not configured.");
        }

        try
        {
            var user = await GetMeAsync(userId, settings.HardcoverApiToken, cancellationToken);
            return new HardcoverConnectionResult(true, true, settings.HardcoverSyncEnabled, user.Id, user.Username, "Connection successful.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "Hardcover status check failed for user {UserId}", userId);
            return new HardcoverConnectionResult(true, false, settings.HardcoverSyncEnabled, null, null, ex.Message);
        }
    }

    public async Task<HardcoverMatchResult> MatchBookAsync(
        Guid userId,
        int bookId,
        int? hardcoverBookId = null,
        int? hardcoverEditionId = null,
        string? searchQuery = null,
        CancellationToken cancellationToken = default)
    {
        using var _ = await _operationLock.AcquireAsync(userId, cancellationToken);

        var settings = await RequireSettingsWithTokenAsync(userId, cancellationToken);
        var book = await GetOwnedBookAsync(userId, bookId, includeTexts: false, cancellationToken);

        var (result, _) = await MatchBookInternalAsync(
            userId,
            settings.HardcoverApiToken!,
            book,
            hardcoverBookId,
            hardcoverEditionId,
            searchQuery,
            claimedHardcoverBookIds: null,
            cancellationToken);

        if (result.Applied)
        {
            await _context.SaveChangesAsync(cancellationToken);
        }

        return result;
    }

    public async Task UnlinkBookAsync(Guid userId, int bookId, CancellationToken cancellationToken = default)
    {
        using var _ = await _operationLock.AcquireAsync(userId, cancellationToken);

        var book = await GetOwnedBookAsync(userId, bookId, includeTexts: false, cancellationToken);
        book.HardcoverBookId = null;
        book.HardcoverEditionId = null;
        book.HardcoverSlug = null;
        book.HardcoverUserBookId = null;
        book.HardcoverUserBookReadId = null;
        book.HardcoverMatchedAt = null;
        book.HardcoverLastSyncedAt = null;
        book.HardcoverAutoMatchDisabled = true;
        book.HardcoverPendingFinishAfterReadId = null;
        ClearPendingRating(book);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task<HardcoverMetadataImportResult> ImportMetadataAsync(Guid userId, int bookId, CancellationToken cancellationToken = default)
    {
        using var _ = await _operationLock.AcquireAsync(userId, cancellationToken);

        var settings = await RequireSettingsWithTokenAsync(userId, cancellationToken);
        var book = await GetOwnedBookAsync(userId, bookId, includeTexts: false, cancellationToken);

        HardcoverBookCandidate? candidate = null;
        if (book.HardcoverBookId.HasValue)
        {
            candidate = (await FindBooksByIdsAsync(
                    userId,
                    settings.HardcoverApiToken!,
                    new[] { book.HardcoverBookId.Value },
                    book.Language,
                    book.HardcoverEditionId,
                    cancellationToken))
                .FirstOrDefault();
        }

        if (candidate == null)
        {
            var (match, _) = await MatchBookInternalAsync(
                userId,
                settings.HardcoverApiToken!,
                book,
                hardcoverBookId: null,
                hardcoverEditionId: null,
                searchQuery: null,
                claimedHardcoverBookIds: null,
                cancellationToken);
            if (!match.Applied || match.AppliedCandidate == null)
            {
                return new HardcoverMetadataImportResult(false, Array.Empty<string>(), match.Candidates, match.Message);
            }

            candidate = match.AppliedCandidate;
        }

        var changed = await ApplyMissingMetadataAsync(userId, book, candidate, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);

        return new HardcoverMetadataImportResult(
            true,
            changed,
            new[] { candidate },
            changed.Count == 0 ? "No missing metadata to import." : "Imported Hardcover metadata.");
    }

    public async Task<HardcoverProgressSyncResult> SyncProgressAsync(
        Guid userId,
        int bookId,
        bool requireSyncEnabled = false,
        decimal? rating = null,
        CancellationToken cancellationToken = default)
    {
        if (_externalWritesDisabled)
        {
            return HardcoverProgressSyncResult.SkippedResult(bookId, ExternalWritesOptions.DisabledMessage);
        }

        using var _ = await _operationLock.AcquireAsync(userId, cancellationToken);

        UserSettings settings;
        if (requireSyncEnabled)
        {
            var loadedSettings = await GetSettingsAsync(userId, cancellationToken);
            if (loadedSettings == null || !loadedSettings.HardcoverSyncEnabled)
            {
                return HardcoverProgressSyncResult.SkippedResult(bookId, "Hardcover sync is disabled.");
            }

            if (string.IsNullOrWhiteSpace(loadedSettings.HardcoverApiToken))
            {
                return HardcoverProgressSyncResult.SkippedResult(bookId, "Hardcover API token is not configured.");
            }

            settings = loadedSettings;
        }
        else
        {
            settings = await RequireSettingsWithTokenAsync(userId, cancellationToken);
        }

        var book = await GetOwnedBookAsync(userId, bookId, includeTexts: true, cancellationToken);
        if (book.IsRereading && !book.HasPendingHardcoverSync)
        {
            return HardcoverProgressSyncResult.SkippedResult(bookId, RereadSyncPaused);
        }
        if (!book.HardcoverBookId.HasValue)
        {
            if (book.HardcoverAutoMatchDisabled)
            {
                return HardcoverProgressSyncResult.SkippedResult(bookId, UnlinkedBookMessage);
            }

            var (match, _) = await MatchBookInternalAsync(
                userId,
                settings.HardcoverApiToken!,
                book,
                hardcoverBookId: null,
                hardcoverEditionId: null,
                searchQuery: null,
                claimedHardcoverBookIds: null,
                cancellationToken);
            if (!match.Applied)
            {
                if (book.HardcoverPendingFinishAfterReadId is < 0)
                {
                    book.HardcoverPendingFinishAfterReadId = null;
                    await _context.SaveChangesAsync(CancellationToken.None);
                }
                return HardcoverProgressSyncResult.SkippedResult(bookId, match.Message);
            }
        }

        var (result, _) = await SyncProgressCoreAsync(
            userId,
            settings,
            book,
            rating,
            usePrefetchedRemote: false,
            prefetchedRemote: null,
            skipIfUnchanged: requireSyncEnabled && !rating.HasValue,
            updateSettingsLastSyncAt: true,
            cancellationToken);

        await _context.SaveChangesAsync(CancellationToken.None);
        return result;
    }

    public async Task<HardcoverSyncAllResult> SyncAllAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        if (_externalWritesDisabled)
        {
            return new HardcoverSyncAllResult(Array.Empty<HardcoverProgressSyncResult>(), ExternalWritesOptions.DisabledMessage);
        }

        using var _ = await _operationLock.AcquireAsync(userId, cancellationToken);

        var settings = await RequireSettingsWithTokenAsync(userId, cancellationToken);
        if (!settings.HardcoverSyncEnabled)
        {
            return new HardcoverSyncAllResult(Array.Empty<HardcoverProgressSyncResult>(), "Hardcover sync is disabled.");
        }

        var token = settings.HardcoverApiToken!;
        var books = await _context.Books
            .Where(book => book.UserId == userId)
            .Include(book => book.Texts)
            .Include(book => book.Language)
            .OrderBy(book => book.Title)
            .ToListAsync(cancellationToken);

        if (books.Count == 0)
        {
            settings.HardcoverLastSyncAt = UtcNow().UtcDateTime;
            await _context.SaveChangesAsync(cancellationToken);
            return new HardcoverSyncAllResult(Array.Empty<HardcoverProgressSyncResult>(), "Synced 0 of 0 books.");
        }

        var preFailures = books.Where(book => book.IsRereading && !book.HasPendingHardcoverSync).ToDictionary(book => book.BookId,
            book => HardcoverProgressSyncResult.SkippedResult(book.BookId, RereadSyncPaused));
        var claimedHardcoverBookIds = books
            .Where(b => b.HardcoverBookId.HasValue)
            .Select(b => b.HardcoverBookId!.Value)
            .ToHashSet();

        // 1. Batch-fetch missing metadata for already-matched books (chunks of 50).
        var matchedNeedingMeta = books
            .Where(b => (!b.IsRereading || b.HasPendingHardcoverSync) && b.HardcoverBookId.HasValue && HasMissingMetadata(b))
            .ToList();

        foreach (var chunk in matchedNeedingMeta.Chunk(MetadataBatchSize))
        {
            try
            {
                var ids = chunk.Select(b => b.HardcoverBookId!.Value).Distinct().ToList();
                var fetched = await FetchRawBooksByIdsAsync(userId, token, ids, cancellationToken);
                var rawById = fetched.ToDictionary(b => b.Id);

                foreach (var book in chunk)
                {
                    if (rawById.TryGetValue(book.HardcoverBookId!.Value, out var raw))
                    {
                        var candidate = BuildCandidate(raw, book.Language, book.HardcoverEditionId);
                        await ApplyMissingMetadataAsync(userId, book, candidate, cancellationToken);
                    }
                }
            }
            catch (HardcoverApiException ex) when (IsFatalBatchError(ex))
            {
                await _context.SaveChangesAsync(CancellationToken.None);
                throw;
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Hardcover batch metadata import failed for chunk");
            }
        }

        // 2. Match unmatched books and fill their metadata from the returned candidate.
        foreach (var book in books.Where(b => (!b.IsRereading || b.HasPendingHardcoverSync) && !b.HardcoverBookId.HasValue && !b.HardcoverAutoMatchDisabled))
        {
            try
            {
                var (match, _) = await MatchBookInternalAsync(
                    userId,
                    token,
                    book,
                    hardcoverBookId: null,
                    hardcoverEditionId: null,
                    searchQuery: null,
                    claimedHardcoverBookIds,
                    cancellationToken);

                if (match.Applied && match.AppliedCandidate != null)
                {
                    claimedHardcoverBookIds.Add(book.HardcoverBookId!.Value);
                    await ApplyMissingMetadataAsync(userId, book, match.AppliedCandidate, cancellationToken);
                }
                else
                {
                    if (book.HardcoverPendingFinishAfterReadId is < 0)
                    {
                        book.HardcoverPendingFinishAfterReadId = null;
                    }
                    preFailures[book.BookId] = HardcoverProgressSyncResult.SkippedResult(book.BookId, match.Message);
                }
            }
            catch (HardcoverApiException ex) when (IsFatalBatchError(ex))
            {
                await _context.SaveChangesAsync(CancellationToken.None);
                throw;
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Hardcover match failed for book {BookId}", book.BookId);
                preFailures[book.BookId] = new HardcoverProgressSyncResult(book.BookId, false, false, 0, null, null, ex.Message);
            }
        }

        // 3. Batch-fetch only the user's matched Hardcover books (chunks of 100).
        var bookIdsToFetch = books
            .Where(b => b.HardcoverBookId.HasValue && !preFailures.ContainsKey(b.BookId))
            .Select(b => b.HardcoverBookId!.Value)
            .Distinct()
            .ToList();

        Dictionary<int, HardcoverUserBook> libraryByBookId;
        if (bookIdsToFetch.Count > 0)
        {
            try
            {
                libraryByBookId = await FetchMyLibraryAsync(userId, token, bookIdsToFetch, cancellationToken);
            }
            catch (HardcoverApiException ex) when (IsFatalBatchError(ex))
            {
                await _context.SaveChangesAsync(CancellationToken.None);
                throw;
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Hardcover library fetch failed during SyncAll for user {UserId}", userId);
                await _context.SaveChangesAsync(CancellationToken.None);
                return BuildAbortedSyncAllResult(books, preFailures, ex.Message);
            }
        }
        else
        {
            libraryByBookId = new Dictionary<int, HardcoverUserBook>();
        }

        // 4. Sync progress for each matched book using the prefetched library state.
        var results = new List<HardcoverProgressSyncResult>(books.Count);
        for (var i = 0; i < books.Count; i++)
        {
            var book = books[i];
            if (preFailures.TryGetValue(book.BookId, out var failure))
            {
                results.Add(failure);
                continue;
            }

            if (!book.HardcoverBookId.HasValue)
            {
                var message = book.HardcoverAutoMatchDisabled ? UnlinkedBookMessage : "No Hardcover match.";
                results.Add(HardcoverProgressSyncResult.SkippedResult(book.BookId, message));
                continue;
            }

            try
            {
                libraryByBookId.TryGetValue(book.HardcoverBookId.Value, out var remoteUserBook);
                var (syncResult, updatedRemote) = await SyncProgressCoreAsync(
                    userId,
                    settings,
                    book,
                    rating: null,
                    usePrefetchedRemote: true,
                    prefetchedRemote: remoteUserBook,
                    skipIfUnchanged: true,
                    updateSettingsLastSyncAt: false,
                    cancellationToken);
                if (updatedRemote != null)
                {
                    libraryByBookId[book.HardcoverBookId.Value] = updatedRemote;
                }
                results.Add(syncResult);
            }
            catch (HardcoverApiException ex) when (IsFatalBatchError(ex))
            {
                await _context.SaveChangesAsync(CancellationToken.None);
                throw;
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Hardcover sync failed for book {BookId}", book.BookId);
                results.Add(new HardcoverProgressSyncResult(book.BookId, false, false, 0, null, null, ex.Message));
            }
        }

        settings.HardcoverLastSyncAt = UtcNow().UtcDateTime;
        await _context.SaveChangesAsync(CancellationToken.None);
        return new HardcoverSyncAllResult(results, $"Synced {results.Count(result => result.Success)} of {results.Count} books.");
    }

    private static bool IsFatalBatchError(HardcoverApiException ex) =>
        ex.ErrorCode is "daily_rate_limit" or "invalid_token" or "insufficient_scope" or "rate_limit" ||
        ex.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests;

    private static HardcoverSyncAllResult BuildAbortedSyncAllResult(
        IReadOnlyList<Book> books,
        IReadOnlyDictionary<int, HardcoverProgressSyncResult> preFailures,
        string errorMessage)
    {
        var results = books
            .Select(b => preFailures.TryGetValue(b.BookId, out var failure)
                ? failure
                : new HardcoverProgressSyncResult(b.BookId, false, false, 0, null, null, errorMessage))
            .ToList();
        return new HardcoverSyncAllResult(results, errorMessage);
    }

    private async Task<bool> IsHardcoverBookAlreadyLinkedAsync(
        Guid userId,
        int currentBookId,
        int hardcoverBookId,
        ISet<int>? claimedHardcoverBookIds,
        CancellationToken cancellationToken)
    {
        if (claimedHardcoverBookIds != null && claimedHardcoverBookIds.Contains(hardcoverBookId))
        {
            return true;
        }

        return await _context.Books.AnyAsync(
            b => b.UserId == userId && b.BookId != currentBookId && b.HardcoverBookId == hardcoverBookId,
            cancellationToken);
    }

    private async Task<(HardcoverMatchResult Result, IReadOnlySet<int> IsbnMatchedBookIds)> MatchBookInternalAsync(
        Guid userId,
        string token,
        Book book,
        int? hardcoverBookId,
        int? hardcoverEditionId,
        string? searchQuery,
        ISet<int>? claimedHardcoverBookIds,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<HardcoverBookCandidate> candidates;
        var isbnMatchedBookIds = new HashSet<int>();
        var isManualSearch = !string.IsNullOrWhiteSpace(searchQuery) && !hardcoverBookId.HasValue;

        if (hardcoverBookId.HasValue)
        {
            if (await IsHardcoverBookAlreadyLinkedAsync(userId, book.BookId, hardcoverBookId.Value, claimedHardcoverBookIds, cancellationToken))
            {
                throw new HardcoverConflictException(DuplicateHardcoverBookMessage);
            }

            candidates = await FindBooksByIdsAsync(
                userId,
                token,
                new[] { hardcoverBookId.Value },
                book.Language,
                hardcoverEditionId,
                cancellationToken);
        }
        else if (isManualSearch)
        {
            (candidates, isbnMatchedBookIds) = await FindCandidatesByManualQueryAsync(
                userId,
                token,
                book,
                searchQuery!.Trim(),
                hardcoverEditionId,
                cancellationToken);
        }
        else
        {
            (candidates, isbnMatchedBookIds) = await FindCandidatesForBookAsync(
                userId,
                token,
                book,
                cancellationToken);
        }

        var scored = candidates
            .Select(candidate =>
            {
                double score;
                if (hardcoverBookId.HasValue)
                {
                    score = 1.0;
                }
                else if (isbnMatchedBookIds.Contains(candidate.BookId))
                {
                    score = 1.0;
                }
                else
                {
                    score = ScoreCandidate(book, candidate);
                }

                return candidate with { Score = score };
            })
            .OrderByDescending(candidate => candidate.Score)
            .ToList();

        var best = scored.FirstOrDefault();
        if (best == null)
        {
            return (new HardcoverMatchResult(false, null, Array.Empty<HardcoverBookCandidate>(), "No Hardcover candidates found."), isbnMatchedBookIds);
        }

        if (hardcoverBookId.HasValue)
        {
            if (await IsHardcoverBookAlreadyLinkedAsync(userId, book.BookId, best.BookId, claimedHardcoverBookIds, cancellationToken))
            {
                throw new HardcoverConflictException(DuplicateHardcoverBookMessage);
            }

            ApplyMatch(book, best, editionExplicitlyChosen: hardcoverEditionId.HasValue);
            return (new HardcoverMatchResult(true, best, scored, "Matched Hardcover book."), isbnMatchedBookIds);
        }

        if (isManualSearch)
        {
            return (new HardcoverMatchResult(false, null, scored, "Review Hardcover search results and choose a match."), isbnMatchedBookIds);
        }

        if (book.HardcoverBookId.HasValue || book.HardcoverAutoMatchDisabled)
        {
            var message = book.HardcoverAutoMatchDisabled ? UnlinkedBookMessage : "Review Hardcover candidates to change your match.";
            return (new HardcoverMatchResult(false, null, scored, message), isbnMatchedBookIds);
        }

        if (best.Score < AutoMatchThreshold)
        {
            return (new HardcoverMatchResult(false, null, scored, "No high-confidence match found. Please review candidates."), isbnMatchedBookIds);
        }

        var isSingleIsbnMatch = isbnMatchedBookIds.Contains(best.BookId) && scored.Count == 1;
        if (!isSingleIsbnMatch && scored.Count(c => c.Score >= AutoMatchThreshold) > 1)
        {
            var runnerUp = scored[1];
            if (Math.Round(best.Score - runnerUp.Score, 6) < 0.02)
            {
                return (new HardcoverMatchResult(false, null, scored, "Multiple Hardcover books matched this title. Please choose the right one."), isbnMatchedBookIds);
            }
        }

        if (await IsHardcoverBookAlreadyLinkedAsync(userId, book.BookId, best.BookId, claimedHardcoverBookIds, cancellationToken))
        {
            return (new HardcoverMatchResult(false, null, scored, DuplicateHardcoverBookMessage), isbnMatchedBookIds);
        }

        ApplyMatch(book, best, editionExplicitlyChosen: false);
        return (new HardcoverMatchResult(true, best, scored, "Matched Hardcover book."), isbnMatchedBookIds);
    }

    private static (bool ShouldSkip, int EffectiveStatusId, bool AlreadyFinishedOnHardcover, string? SkipMessage) EvaluateRemoteState(
        Book book,
        HardcoverUserBook remote,
        int desiredStatusId,
        decimal? rating)
    {
        var alreadyFinished = HasFinishedRead(book, remote);

        if (remote.StatusId == ReadStatus && desiredStatusId < ReadStatus)
        {
            if (!rating.HasValue)
            {
                return (true, remote.StatusId, alreadyFinished, "Book is already marked Read on Hardcover.");
            }

            return (false, remote.StatusId, alreadyFinished, null);
        }

        if (remote.StatusId != WantToReadStatus && desiredStatusId == WantToReadStatus)
        {
            if (!rating.HasValue)
            {
                return (true, remote.StatusId, alreadyFinished, "Book already has a higher or custom status on Hardcover.");
            }

            return (false, remote.StatusId, alreadyFinished, null);
        }

        return (false, desiredStatusId, alreadyFinished, null);
    }

    private static bool HasFinishedRead(Book book, HardcoverUserBook remote) =>
        remote.StatusId == ReadStatus && remote.ActiveReadId == null &&
        (remote.CompletedReadId.GetValueOrDefault() > Math.Max(0, book.HardcoverPendingFinishAfterReadId.GetValueOrDefault()) ||
            (book.HardcoverPendingFinishAfterReadId is >= 0 && remote.CompletedPendingRead));

    private async Task<(HardcoverProgressSyncResult Result, HardcoverUserBook? UpdatedRemote)> SyncProgressCoreAsync(
        Guid userId,
        UserSettings settings,
        Book book,
        decimal? rating,
        bool usePrefetchedRemote,
        HardcoverUserBook? prefetchedRemote,
        bool skipIfUnchanged,
        bool updateSettingsLastSyncAt,
        CancellationToken cancellationToken)
    {
        var token = settings.HardcoverApiToken!;
        var pendingRatingId = book.HardcoverPendingRatingId;
        if (pendingRatingId is { } obsoleteRating && book.HardcoverPendingRatingBookId is { } ratedBookId && ratedBookId != book.HardcoverBookId)
        {
            await ClearPendingRatingAsync(book, obsoleteRating);
            pendingRatingId = null;
        }
        if (pendingRatingId.HasValue) rating = book.HardcoverPendingRating;
        if (book.IsRereading && !pendingRatingId.HasValue && !book.HardcoverPendingFinishAfterReadId.HasValue)
        {
            return (HardcoverProgressSyncResult.SkippedResult(book.BookId, RereadSyncPaused), prefetchedRemote);
        }
        var allPartsFinished = book.Texts.Count > 0 && book.Texts.All(book.IsPartFinished);
        var anyPartFinished = book.Texts.Any(book.IsPartFinished);
        var isFinished = book.IsFinished || allPartsFinished || book.HardcoverPendingFinishAfterReadId.HasValue || (book.IsRereading && pendingRatingId.HasValue);
        var completion = isFinished ? 100 : CalculatePartCompletion(book);
        if (!isFinished)
        {
            book.HardcoverPendingFinishAfterReadId = null;
            completion = Math.Min(completion, 99.99);
            if (anyPartFinished)
            {
                completion = Math.Max(completion, 0.01);
            }
        }

        var desiredStatusId = ResolveHardcoverStatus(completion, isFinished);

        var remote = usePrefetchedRemote
            ? prefetchedRemote
            : await FindUserBookAsync(userId, token, book, cancellationToken);
        if (usePrefetchedRemote && remote is { StatusId: ReadStatus, ActiveReadId: null } && !HasFinishedRead(book, remote) &&
            book.HardcoverPendingFinishAfterReadId is >= 0 and var earlierReadId && book.HardcoverUserBookReadId <= earlierReadId)
        {
            // The active read at the start of the finish can have an older ID than the history.
            remote = await FindUserBookAsync(userId, token, book, cancellationToken);
        }
        var estimatedProgressPages = EstimateProgressPages(book, completion, isFinished, remote?.ActiveReadEditionId ?? remote?.EditionId);

        // If the book was not found in the user's Hardcover library (prefetched or queried),
        // any locally cached HardcoverUserBookId / HardcoverUserBookReadId is stale.
        if (remote == null)
        {
            book.HardcoverUserBookId = null;
        }
        if (remote?.ActiveReadId == null && book.HardcoverPendingFinishAfterReadId is null or < 0)
        {
            book.HardcoverUserBookReadId = null;
        }

        var effectiveStatusId = desiredStatusId;
        var alreadyFinishedOnHardcover = false;
        var skipReadUpsert = false;

        if (remote != null)
        {
            var (shouldSkip, evaluatedStatusId, evaluatedAlreadyFinished, skipMessage) =
                EvaluateRemoteState(book, remote, desiredStatusId, rating);

            if (shouldSkip)
            {
                book.HardcoverUserBookId = remote.UserBookId;
                book.HardcoverUserBookReadId = remote.ActiveReadId;
                return (HardcoverProgressSyncResult.SkippedResult(book.BookId, skipMessage!), remote);
            }

            effectiveStatusId = evaluatedStatusId;
            alreadyFinishedOnHardcover = evaluatedAlreadyFinished;
            if (remote.StatusId == ReadStatus && desiredStatusId < ReadStatus)
            {
                skipReadUpsert = true;
            }

            if (alreadyFinishedOnHardcover && effectiveStatusId == ReadStatus && !rating.HasValue)
            {
                var syncedNow = UtcNow().UtcDateTime;
                book.HardcoverUserBookId = remote.UserBookId;
                book.HardcoverUserBookReadId = null;
                book.HardcoverLastSyncedAt = syncedNow;
                book.HardcoverPendingFinishAfterReadId = null;
                if (updateSettingsLastSyncAt)
                {
                    settings.HardcoverLastSyncAt = syncedNow;
                }
                return (new HardcoverProgressSyncResult(book.BookId, true, false, completion, effectiveStatusId, estimatedProgressPages, "Synced progress to Hardcover."), remote);
            }

            if (skipIfUnchanged && !rating.HasValue && effectiveStatusId != ReadStatus &&
                IsAlreadyInSync(remote, effectiveStatusId, estimatedProgressPages))
            {
                book.HardcoverUserBookId = remote.UserBookId;
                book.HardcoverUserBookReadId = remote.ActiveReadId;
                book.HardcoverLastSyncedAt = UtcNow().UtcDateTime;
                return (new HardcoverProgressSyncResult(book.BookId, true, false, completion, effectiveStatusId, estimatedProgressPages, "Synced progress to Hardcover."), remote);
            }
        }

        if (isFinished && !alreadyFinishedOnHardcover && book.HardcoverPendingFinishAfterReadId is null or < 0)
        {
            // A retry must distinguish this read from any entries completed before the finish.
            book.HardcoverPendingFinishAfterReadId = remote?.CompletedReadId ?? 0;
            book.HardcoverUserBookReadId = remote?.ActiveReadId;
            await _context.SaveChangesAsync(cancellationToken);
        }

        var ensured = await EnsureUserBookAsync(userId, token, book, remote, effectiveStatusId, rating, cancellationToken);
        if (ensured.Skipped)
        {
            book.HardcoverUserBookId = ensured.UserBook.UserBookId;
            book.HardcoverUserBookReadId = ensured.UserBook.ActiveReadId;
            return (HardcoverProgressSyncResult.SkippedResult(book.BookId, ensured.SkipMessage!), ensured.UserBook);
        }

        if (pendingRatingId is { } deliveredRatingId)
        {
            // The shelf mutation wrote the rating. A failed read-entry write should not resend it.
            await ClearPendingRatingAsync(book, deliveredRatingId);
        }

        var userBook = ensured.UserBook;
        effectiveStatusId = userBook.StatusId;
        alreadyFinishedOnHardcover = alreadyFinishedOnHardcover || ensured.AlreadyFinishedOnHardcover;
        skipReadUpsert = skipReadUpsert || alreadyFinishedOnHardcover || ensured.SkipReadUpsert;

        var userBookId = userBook.UserBookId;

        int? userBookReadId = alreadyFinishedOnHardcover
            ? null
            : userBook.ActiveReadId;

        if ((completion > 0 || isFinished) && !skipReadUpsert)
        {
            (userBookId, userBookReadId, estimatedProgressPages) = await UpsertUserBookReadAsync(
                userId,
                token,
                book,
                userBook,
                completion,
                isFinished,
                cancellationToken);
        }

        var now = UtcNow().UtcDateTime;
        book.HardcoverUserBookId = userBookId;
        book.HardcoverUserBookReadId = userBookReadId;
        book.HardcoverLastSyncedAt = now;
        if (isFinished) book.HardcoverPendingFinishAfterReadId = null;
        if (updateSettingsLastSyncAt)
        {
            settings.HardcoverLastSyncAt = now;
        }

        var updatedRemote = new HardcoverUserBook(
            userBookId,
            effectiveStatusId,
            userBook.EditionId,
            isFinished || alreadyFinishedOnHardcover ? null : userBookReadId,
            isFinished || alreadyFinishedOnHardcover ? null : (userBook.ActiveReadEditionId ?? book.HardcoverEditionId),
            isFinished || alreadyFinishedOnHardcover ? null : estimatedProgressPages,
            isFinished ? userBookReadId ?? userBook.CompletedReadId : userBook.CompletedReadId);

        return (new HardcoverProgressSyncResult(book.BookId, true, false, completion, effectiveStatusId, estimatedProgressPages, "Synced progress to Hardcover."), updatedRemote);
    }

    private static void ClearPendingRating(Book book)
    {
        book.HardcoverPendingRating = null;
        book.HardcoverPendingRatingId = null;
        book.HardcoverPendingRatingBookId = null;
    }

    private async Task ClearPendingRatingAsync(Book book, Guid ratingId)
    {
        // The user can submit a newer rating while this remote call is in flight.
        var pending = _context.Books.Where(b => b.BookId == book.BookId && b.HardcoverPendingRatingId == ratingId);
        if (!_context.Database.IsRelational())
        {
            if (await pending.AnyAsync())
            {
                ClearPendingRating(book);
                await _context.SaveChangesAsync();
            }
            return;
        }

        var changed = await pending.ExecuteUpdateAsync(setters => setters
            .SetProperty(b => b.HardcoverPendingRating, (decimal?)null)
            .SetProperty(b => b.HardcoverPendingRatingId, (Guid?)null)
            .SetProperty(b => b.HardcoverPendingRatingBookId, (int?)null));
        if (changed == 1)
        {
            var entry = _context.Entry(book);
            var rating = entry.Property(b => b.HardcoverPendingRating);
            var id = entry.Property(b => b.HardcoverPendingRatingId);
            var ratedBookId = entry.Property(b => b.HardcoverPendingRatingBookId);
            rating.CurrentValue = rating.OriginalValue = null;
            id.CurrentValue = id.OriginalValue = null;
            ratedBookId.CurrentValue = ratedBookId.OriginalValue = null;
            rating.IsModified = false;
            id.IsModified = false;
            ratedBookId.IsModified = false;
        }
    }

    private static int? EstimateProgressPages(Book book, double completion, bool isFinished, int? remoteEditionId)
    {
        if (book.PageCount is not > 0 || (remoteEditionId.HasValue && remoteEditionId != book.HardcoverEditionId))
        {
            return null;
        }

        var pages = book.PageCount.Value;
        var maxPages = !isFinished && pages > 1 ? pages - 1 : pages;
        return Math.Clamp((int)Math.Round(pages * completion / 100.0), 0, maxPages);
    }

    private static bool IsAlreadyInSync(HardcoverUserBook remote, int desiredStatusId, int? estimatedProgressPages)
    {
        if (remote.StatusId != desiredStatusId)
        {
            return false;
        }

        if (desiredStatusId == WantToReadStatus)
        {
            return true;
        }

        return remote.ActiveReadId.HasValue && (!estimatedProgressPages.HasValue || remote.ActiveReadProgressPages == estimatedProgressPages);
    }

    private async Task<UserSettings?> GetSettingsAsync(Guid userId, CancellationToken cancellationToken)
    {
        return await _context.UserSettings.FirstOrDefaultAsync(settings => settings.UserId == userId, cancellationToken);
    }

    private async Task<UserSettings> RequireSettingsWithTokenAsync(Guid userId, CancellationToken cancellationToken)
    {
        var settings = await GetSettingsAsync(userId, cancellationToken);
        if (settings == null || string.IsNullOrWhiteSpace(settings.HardcoverApiToken))
        {
            throw new HardcoverConfigurationException("Hardcover API token is not configured.");
        }

        return settings;
    }

    private async Task<Book> GetOwnedBookAsync(Guid userId, int bookId, bool includeTexts, CancellationToken cancellationToken)
    {
        IQueryable<Book> query = _context.Books
            .Where(book => book.BookId == bookId && book.UserId == userId)
            .Include(book => book.Language);
        if (includeTexts)
        {
            query = query.Include(book => book.Texts);
        }

        return await query.FirstOrDefaultAsync(cancellationToken)
            ?? throw new HardcoverBookNotFoundException("Book not found.");
    }

    private async Task<HardcoverUser> GetMeAsync(Guid userId, string token, CancellationToken cancellationToken)
    {
        const string query = """
            query {
              me {
                id
                username
                user_books(limit: 1) { id }
              }
            }
            """;
        var data = await ExecuteGraphQlAsync(userId, token, query, null, cancellationToken);
        var me = GetMeElement(data);
        return new HardcoverUser(me.GetProperty("id").GetInt32(), GetString(me, "username"));
    }

    private async Task<(IReadOnlyList<HardcoverBookCandidate> Candidates, HashSet<int> IsbnMatchedBookIds)> FindCandidatesByManualQueryAsync(
        Guid userId,
        string token,
        Book book,
        string queryText,
        int? preferredEditionId,
        CancellationToken cancellationToken)
    {
        var isbnMatchedBookIds = new HashSet<int>();

        var idUrlMatch = HardcoverIdUrlRegex.Match(queryText);
        if (idUrlMatch.Success && int.TryParse(idUrlMatch.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var urlBookId))
        {
            var byUrlId = await FindBooksByIdsAsync(userId, token, new[] { urlBookId }, book.Language, preferredEditionId, cancellationToken);
            return (byUrlId, isbnMatchedBookIds);
        }

        if (queryText.StartsWith('#') &&
            int.TryParse(queryText[1..].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var hashBookId) &&
            hashBookId > 0)
        {
            var byHashId = await FindBooksByIdsAsync(userId, token, new[] { hashBookId }, book.Language, preferredEditionId, cancellationToken);
            return (byHashId, isbnMatchedBookIds);
        }

        var slugMatch = HardcoverBookSlugUrlRegex.Match(queryText);
        if (slugMatch.Success)
        {
            var slug = Uri.UnescapeDataString(slugMatch.Groups[1].Value).Trim().ToLowerInvariant();
            var bySlug = await FindBooksBySlugAsync(userId, token, slug, book.Language, preferredEditionId, cancellationToken);
            return (bySlug, isbnMatchedBookIds);
        }

        if (TryNormalizeIsbn13(queryText, out var isbn13))
        {
            var (byIsbn, matchedIds) = await FindBooksByIsbn13Async(userId, token, isbn13, book.Language, cancellationToken);
            foreach (var id in matchedIds)
            {
                isbnMatchedBookIds.Add(id);
            }
            if (byIsbn.Count > 0)
            {
                return (byIsbn, isbnMatchedBookIds);
            }
        }

        var ids = await SearchBookIdsAsync(userId, token, queryText, cancellationToken);
        var combinedIds = new List<int>(ids);
        if (int.TryParse(queryText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var numericId) &&
            numericId > 0 &&
            !IsIsbn13(queryText) &&
            !combinedIds.Contains(numericId))
        {
            combinedIds.Add(numericId);
        }

        var candidates = combinedIds.Count > 0
            ? await FindBooksByIdsAsync(userId, token, combinedIds, book.Language, preferredEditionId, cancellationToken)
            : Array.Empty<HardcoverBookCandidate>();

        if (candidates.Count > 0)
        {
            return (candidates, isbnMatchedBookIds);
        }

        var exact = await FindBooksByExactTitleAsync(userId, token, queryText, book.Language, preferredEditionId, cancellationToken);
        return (exact, isbnMatchedBookIds);
    }

    private async Task<(IReadOnlyList<HardcoverBookCandidate> Candidates, HashSet<int> IsbnMatchedBookIds)> FindCandidatesForBookAsync(
        Guid userId,
        string token,
        Book book,
        CancellationToken cancellationToken)
    {
        var isbnMatchedBookIds = new HashSet<int>();

        if (TryNormalizeIsbn13(book.Isbn13, out var isbn13))
        {
            var (byIsbn, matchedIds) = await FindBooksByIsbn13Async(userId, token, isbn13, book.Language, cancellationToken);
            if (byIsbn.Count > 0)
            {
                foreach (var id in matchedIds)
                {
                    isbnMatchedBookIds.Add(id);
                }
                return (byIsbn, isbnMatchedBookIds);
            }
        }

        IReadOnlyList<int> ids = Array.Empty<int>();
        if (!string.IsNullOrWhiteSpace(book.Author))
        {
            ids = await SearchBookIdsAsync(userId, token, $"{book.Title} {book.Author}", cancellationToken);
        }

        if (ids.Count == 0)
        {
            ids = await SearchBookIdsAsync(userId, token, book.Title, cancellationToken);
        }

        var candidates = ids.Count > 0
            ? await FindBooksByIdsAsync(userId, token, ids, book.Language, preferredEditionId: null, cancellationToken)
            : Array.Empty<HardcoverBookCandidate>();

        if (candidates.Count > 0)
        {
            return (candidates, isbnMatchedBookIds);
        }

        var exact = await FindBooksByExactTitleAsync(userId, token, book.Title, book.Language, preferredEditionId: null, cancellationToken);
        return (exact, isbnMatchedBookIds);
    }

    private async Task<(IReadOnlyList<HardcoverBookCandidate> Candidates, HashSet<int> MatchedBookIds)> FindBooksByIsbn13Async(
        Guid userId,
        string token,
        string isbn13,
        Language? bookLanguage,
        CancellationToken cancellationToken)
    {
        var query = $$"""
            query BooksByIsbn($isbn13: String!) {
              editions(where: { isbn_13: { _eq: $isbn13 } }, limit: 10) {
                book_id
            {{EditionSelectionFields}}
              }
            }
            """;

        var data = await ExecuteGraphQlAsync(userId, token, query, new { isbn13 }, cancellationToken);
        if (!data.TryGetProperty("editions", out var editions) || editions.ValueKind != JsonValueKind.Array)
        {
            return (Array.Empty<HardcoverBookCandidate>(), new HashSet<int>());
        }

        var matchedEditionByBookId = new Dictionary<int, RawHardcoverEdition>();
        var bookIds = new List<int>();
        foreach (var edition in editions.EnumerateArray())
        {
            if (edition.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var bId = GetInt(edition, "book_id");
            var parsedEdition = ParseRawEdition(edition);
            if (bId.HasValue && parsedEdition != null && !matchedEditionByBookId.ContainsKey(bId.Value))
            {
                matchedEditionByBookId[bId.Value] = parsedEdition;
                bookIds.Add(bId.Value);
            }
        }

        if (bookIds.Count == 0)
        {
            return (Array.Empty<HardcoverBookCandidate>(), new HashSet<int>());
        }

        var rawBooks = await FetchRawBooksByIdsAsync(userId, token, bookIds, cancellationToken);
        var rawById = rawBooks.ToDictionary(b => b.Id);
        var results = new List<HardcoverBookCandidate>();
        foreach (var bId in bookIds)
        {
            if (rawById.TryGetValue(bId, out var raw))
            {
                int? matchedEditionId = null;
                if (matchedEditionByBookId.TryGetValue(bId, out var matchedEdition))
                {
                    matchedEditionId = matchedEdition.EditionId;
                    raw = MergeEditionIntoBook(raw, matchedEdition);
                }

                results.Add(BuildCandidate(raw, bookLanguage, matchedEditionId));
            }
        }

        return (results, bookIds.ToHashSet());
    }

    private async Task<IReadOnlyList<int>> SearchBookIdsAsync(Guid userId, string token, string title, CancellationToken cancellationToken)
    {
        const string query = """
            query SearchBooks($query: String!) {
              search(query: $query, query_type: "Book", per_page: 10, page: 1) {
                ids
              }
            }
            """;

        var data = await ExecuteGraphQlAsync(userId, token, query, new { query = title }, cancellationToken);
        if (!data.TryGetProperty("search", out var search) ||
            search.ValueKind != JsonValueKind.Object ||
            !search.TryGetProperty("ids", out var ids) ||
            ids.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<int>();
        }

        var result = new List<int>();
        var seen = new HashSet<int>();
        foreach (var id in ids.EnumerateArray())
        {
            int parsedId;
            if (id.ValueKind == JsonValueKind.Number && id.TryGetInt32(out parsedId))
            {
                // Numeric JSON value.
            }
            else if (id.ValueKind == JsonValueKind.String &&
                     int.TryParse(id.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsedId))
            {
                // Numeric string JSON value.
            }
            else
            {
                continue;
            }

            if (seen.Add(parsedId))
            {
                result.Add(parsedId);
                if (result.Count == 10)
                {
                    break;
                }
            }
        }

        return result;
    }

    private const string EditionSelectionFields = """
                  id
                  title
                  isbn_13
                  pages
                  release_date
                  reading_format_id
                  edition_format
                  language { code2 code3 language }
                  publisher { name }
                  image { url }
        """;

    private const string BookSelectionFields = $$"""
                id
                title
                slug
                description
                pages
                release_date
                users_count
                image { url }
                contributions { contribution author { name } }
                editions(limit: 20, order_by: { users_count: desc_nulls_last }) {
        {{EditionSelectionFields}}
                }
        """;

    private async Task<IReadOnlyList<HardcoverBookCandidate>> FindBooksByIdsAsync(
        Guid userId,
        string token,
        IEnumerable<int> ids,
        Language? bookLanguage,
        int? preferredEditionId,
        CancellationToken cancellationToken)
    {
        var distinctIds = ids.Distinct().Take(MetadataBatchSize).ToList();
        if (distinctIds.Count == 0)
        {
            return Array.Empty<HardcoverBookCandidate>();
        }

        var rawBooks = await FetchRawBooksByIdsAsync(userId, token, distinctIds, cancellationToken);
        var rawById = rawBooks.ToDictionary(b => b.Id);

        if (preferredEditionId.HasValue && distinctIds.Count == 1 && rawById.TryGetValue(distinctIds[0], out var singleRaw) &&
            !singleRaw.Editions.Any(e => e.EditionId == preferredEditionId.Value))
        {
            var fetchedEdition = await FetchRawEditionByIdAsync(userId, token, preferredEditionId.Value, singleRaw.Id, cancellationToken);
            if (fetchedEdition != null)
            {
                rawById[singleRaw.Id] = MergeEditionIntoBook(singleRaw, fetchedEdition);
            }
        }

        // Preserve the caller's ordering (e.g., Typesense relevance order from search.ids).
        var candidates = new List<HardcoverBookCandidate>(rawBooks.Count);
        foreach (var id in distinctIds)
        {
            if (rawById.TryGetValue(id, out var raw))
            {
                candidates.Add(BuildCandidate(raw, bookLanguage, preferredEditionId));
            }
        }

        return candidates;
    }

    private async Task<RawHardcoverEdition?> FetchRawEditionByIdAsync(
        Guid userId,
        string token,
        int editionId,
        int expectedBookId,
        CancellationToken cancellationToken)
    {
        var query = $$"""
            query EditionById($id: Int!) {
              editions(where: { id: { _eq: $id } }, limit: 1) {
                book_id
            {{EditionSelectionFields}}
              }
            }
            """;

        var data = await ExecuteGraphQlAsync(userId, token, query, new { id = editionId }, cancellationToken);
        if (!data.TryGetProperty("editions", out var editions) || editions.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var edition in editions.EnumerateArray())
        {
            if (edition.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var editionBookId = GetInt(edition, "book_id");
            if (editionBookId.HasValue && editionBookId.Value != expectedBookId)
            {
                continue;
            }

            var parsed = ParseRawEdition(edition);
            if (parsed != null)
            {
                return parsed;
            }
        }

        return null;
    }

    private async Task<IReadOnlyList<RawHardcoverBook>> FetchRawBooksByIdsAsync(
        Guid userId,
        string token,
        IReadOnlyCollection<int> ids,
        CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
        {
            return Array.Empty<RawHardcoverBook>();
        }

        var query = $$"""
            query BooksByIds($ids: [Int!], $limit: Int!) {
              books(where: { id: { _in: $ids } }, limit: $limit) {
            {{BookSelectionFields}}
              }
            }
            """;

        var data = await ExecuteGraphQlAsync(userId, token, query, new { ids, limit = ids.Count }, cancellationToken);
        return ParseRawBooks(data);
    }

    private async Task<IReadOnlyList<HardcoverBookCandidate>> FindBooksByExactTitleAsync(
        Guid userId,
        string token,
        string title,
        Language? bookLanguage,
        int? preferredEditionId,
        CancellationToken cancellationToken)
    {
        var query = $$"""
            query BooksByTitle($title: String!) {
              books(where: { title: { _eq: $title } }, limit: 10) {
            {{BookSelectionFields}}
              }
            }
            """;

        var data = await ExecuteGraphQlAsync(userId, token, query, new { title }, cancellationToken);
        return ParseRawBooks(data)
            .Select(raw => BuildCandidate(raw, bookLanguage, preferredEditionId))
            .ToList();
    }

    private async Task<IReadOnlyList<HardcoverBookCandidate>> FindBooksBySlugAsync(
        Guid userId,
        string token,
        string slug,
        Language? bookLanguage,
        int? preferredEditionId,
        CancellationToken cancellationToken)
    {
        var query = $$"""
            query BooksBySlug($slug: String!) {
              books(where: { slug: { _eq: $slug } }, limit: 1) {
            {{BookSelectionFields}}
              }
            }
            """;

        var data = await ExecuteGraphQlAsync(userId, token, query, new { slug }, cancellationToken);
        return ParseRawBooks(data)
            .Select(raw => BuildCandidate(raw, bookLanguage, preferredEditionId))
            .ToList();
    }

    private static IReadOnlyList<RawHardcoverBook> ParseRawBooks(JsonElement data)
    {
        if (!data.TryGetProperty("books", out var books) || books.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<RawHardcoverBook>();
        }

        var parsed = new List<RawHardcoverBook>();
        foreach (var book in books.EnumerateArray())
        {
            var id = GetInt(book, "id");
            if (!id.HasValue)
            {
                continue;
            }

            var authors = ParseAuthors(book);
            var author = authors.Count > 0 ? string.Join(", ", authors) : null;

            var editionOptions = new List<RawHardcoverEdition>();
            if (book.TryGetProperty("editions", out var editions) && editions.ValueKind == JsonValueKind.Array)
            {
                foreach (var edition in editions.EnumerateArray())
                {
                    var parsedEdition = ParseRawEdition(edition);
                    if (parsedEdition != null)
                    {
                        editionOptions.Add(parsedEdition);
                    }
                }
            }

            parsed.Add(new RawHardcoverBook(
                Id: id.Value,
                Title: GetString(book, "title") ?? string.Empty,
                Slug: GetString(book, "slug"),
                Description: GetString(book, "description"),
                Author: author,
                Authors: authors,
                ReleaseDate: ParseDate(GetString(book, "release_date")),
                Pages: GetInt(book, "pages"),
                ImageUrl: GetImageUrl(book),
                UsersCount: GetInt(book, "users_count") ?? 0,
                Editions: editionOptions));
        }

        return parsed;
    }

    private static IReadOnlyList<string> ParseAuthors(JsonElement book)
    {
        if (!book.TryGetProperty("contributions", out var contributions) || contributions.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var primaryAuthors = new List<string>();
        var fallbackAuthors = new List<string>();

        foreach (var contribution in contributions.EnumerateArray())
        {
            if (contribution.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (!contribution.TryGetProperty("author", out var authorElement) || authorElement.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var name = GetString(authorElement, "name")?.Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            var role = GetString(contribution, "contribution")?.Trim();
            var isPrimary = string.IsNullOrEmpty(role) ||
                            string.Equals(role, "Author", StringComparison.OrdinalIgnoreCase);

            var targetList = isPrimary ? primaryAuthors : fallbackAuthors;
            if (!targetList.Contains(name, StringComparer.OrdinalIgnoreCase))
            {
                targetList.Add(name);
            }
        }

        return primaryAuthors.Count > 0 ? primaryAuthors : fallbackAuthors;
    }

    private static RawHardcoverEdition? ParseRawEdition(JsonElement edition)
    {
        if (edition.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var edId = GetInt(edition, "id");
        if (!edId.HasValue)
        {
            return null;
        }

        string? langName = null;
        string? langCode2 = null;
        string? langCode3 = null;
        if (edition.TryGetProperty("language", out var langEl) && langEl.ValueKind == JsonValueKind.Object)
        {
            langName = GetString(langEl, "language");
            langCode2 = GetString(langEl, "code2");
            langCode3 = GetString(langEl, "code3");
        }

        var publisher = edition.TryGetProperty("publisher", out var pubEl) && pubEl.ValueKind == JsonValueKind.Object
            ? GetString(pubEl, "name")
            : null;

        return new RawHardcoverEdition(
            EditionId: edId.Value,
            Title: GetString(edition, "title"),
            Language: langName,
            LanguageCode2: langCode2,
            LanguageCode3: langCode3,
            Format: GetString(edition, "edition_format"),
            ReadingFormatId: GetInt(edition, "reading_format_id"),
            Pages: GetInt(edition, "pages"),
            Isbn13: GetString(edition, "isbn_13"),
            Publisher: publisher,
            ReleaseDate: ParseDate(GetString(edition, "release_date")),
            ImageUrl: GetImageUrl(edition));
    }

    private static RawHardcoverBook MergeEditionIntoBook(RawHardcoverBook raw, RawHardcoverEdition edition)
    {
        if (raw.Editions.Any(e => e.EditionId == edition.EditionId))
        {
            return raw;
        }

        var merged = new List<RawHardcoverEdition>(raw.Editions.Count + 1) { edition };
        merged.AddRange(raw.Editions);
        return raw with { Editions = merged };
    }

    private static HardcoverBookCandidate BuildCandidate(
        RawHardcoverBook raw,
        Language? bookLanguage,
        int? preferredEditionId)
    {
        var bestEdition = SelectBestEdition(raw.Editions, bookLanguage, preferredEditionId);
        var editionOptions = raw.Editions
            .Select(e => new HardcoverEditionOption(
                e.EditionId,
                e.Title,
                e.Language,
                e.LanguageCode,
                e.Format,
                e.Pages,
                e.Isbn13,
                e.Publisher,
                e.ImageUrl))
            .ToList();

        return new HardcoverBookCandidate(
            BookId: raw.Id,
            EditionId: bestEdition?.EditionId,
            Title: raw.Title,
            Slug: raw.Slug,
            Description: raw.Description,
            Author: raw.Author,
            Isbn13: bestEdition?.Isbn13,
            Publisher: bestEdition?.Publisher,
            ReleaseDate: raw.ReleaseDate ?? bestEdition?.ReleaseDate,
            Pages: bestEdition?.Pages ?? raw.Pages,
            ImageUrl: bestEdition?.ImageUrl ?? raw.ImageUrl,
            Score: 0,
            Editions: editionOptions)
        {
            PrimaryAuthors = raw.Authors
        };
    }

    private static RawHardcoverEdition? SelectBestEdition(
        IReadOnlyList<RawHardcoverEdition> editions,
        Language? bookLanguage,
        int? preferredEditionId)
    {
        if (editions.Count == 0)
        {
            return null;
        }

        if (preferredEditionId.HasValue)
        {
            var explicitMatch = editions.FirstOrDefault(e => e.EditionId == preferredEditionId.Value);
            if (explicitMatch != null)
            {
                return explicitMatch;
            }
        }

        IReadOnlyList<RawHardcoverEdition> pool = editions;
        if (bookLanguage != null)
        {
            var targetCode = bookLanguage.Code.Trim().Split('-', '_')[0];
            var targetName = bookLanguage.Name.Trim();
            var languageMatches = editions.Where(e =>
                (!string.IsNullOrWhiteSpace(targetCode) &&
                 (LanguageCodeMatches(e.LanguageCode2, targetCode) || LanguageCodeMatches(e.LanguageCode3, targetCode))) ||
                (!string.IsNullOrWhiteSpace(targetName) &&
                 !string.IsNullOrWhiteSpace(e.Language) &&
                 string.Equals(e.Language.Trim(), targetName, StringComparison.OrdinalIgnoreCase)))
                .ToList();

            if (languageMatches.Count > 0)
            {
                pool = languageMatches;
            }
        }

        return pool
            .OrderBy(GetEditionFormatRank)
            .First();
    }

    private static bool LanguageCodeMatches(string? editionCode, string targetCode) =>
        !string.IsNullOrWhiteSpace(editionCode) &&
        string.Equals(editionCode.Trim().Split('-', '_')[0], targetCode, StringComparison.OrdinalIgnoreCase);

    private static int GetEditionFormatRank(RawHardcoverEdition edition)
    {
        var hasPages = edition.Pages is > 0;
        var isEbookOrPhysical = edition.ReadingFormatId is 1 or 4;
        var isAudioOnly = edition.ReadingFormatId == 2;

        if (isEbookOrPhysical && hasPages) return 0;
        if (isEbookOrPhysical) return 1;
        if (!isAudioOnly && hasPages) return 2;
        if (!isAudioOnly) return 3;
        return 4;
    }

    private static double ScoreCandidate(Book book, HardcoverBookCandidate candidate)
    {
        var localTitle = NormalizeForMatch(book.Title);
        var remoteTitle = NormalizeForMatch(candidate.Title);
        if (localTitle.Length == 0 || remoteTitle.Length == 0)
        {
            return 0;
        }

        double titleScore;
        if (localTitle == remoteTitle)
        {
            titleScore = 0.97;
        }
        else if (remoteTitle.Contains(localTitle, StringComparison.Ordinal) || localTitle.Contains(remoteTitle, StringComparison.Ordinal))
        {
            titleScore = 0.84;
        }
        else
        {
            var localWords = localTitle.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
            var remoteWords = remoteTitle.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
            if (localWords.Count == 0 || remoteWords.Count == 0)
            {
                return 0;
            }

            var intersection = localWords.Intersect(remoteWords).Count();
            var union = localWords.Union(remoteWords).Count();
            titleScore = Math.Round((double)intersection / union, 3);
        }

        var remoteAuthors = candidate.PrimaryAuthors.Count > 0
            ? candidate.PrimaryAuthors
            : (!string.IsNullOrWhiteSpace(candidate.Author) ? new[] { candidate.Author! } : Array.Empty<string>());

        if (!string.IsNullOrWhiteSpace(book.Author) && remoteAuthors.Count > 0)
        {
            var localAuthorTokens = ExtractMeaningfulAuthorTokens(book.Author);
            var remoteAuthorTokenLists = remoteAuthors
                .Select(ExtractMeaningfulAuthorTokens)
                .Where(tokens => tokens.Count > 0)
                .ToList();

            if (localAuthorTokens.Count > 0 && remoteAuthorTokenLists.Count > 0)
            {
                if (remoteAuthorTokenLists.Any(remoteTokens => AuthorsMatch(localAuthorTokens, remoteTokens)))
                {
                    return Math.Min(0.99, Math.Round(titleScore + 0.02, 3));
                }

                // Conflicting author on an identical/similar title must not auto-match.
                return Math.Min(titleScore, 0.75);
            }
        }

        return titleScore;
    }

    private static List<string> ExtractMeaningfulAuthorTokens(string author) =>
        NormalizeForMatch(author)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(token => token.Length > 1 && !AuthorNameParticles.Contains(token))
            .ToList();

    private static bool AuthorsMatch(IReadOnlyList<string> localTokens, IReadOnlyList<string> remoteTokens)
    {
        if (localTokens.Count == 0 || remoteTokens.Count == 0)
        {
            return false;
        }

        if (localTokens.Count == 1 && remoteTokens.Count == 1)
        {
            return string.Equals(localTokens[0], remoteTokens[0], StringComparison.Ordinal);
        }

        if (string.Equals(localTokens[^1], remoteTokens[^1], StringComparison.Ordinal))
        {
            return true;
        }

        var remoteSet = remoteTokens.ToHashSet(StringComparer.Ordinal);
        var overlapCount = localTokens.Distinct(StringComparer.Ordinal).Count(remoteSet.Contains);
        return overlapCount >= 2;
    }

    private static string NormalizeForMatch(string value)
    {
        var normalized = value.ToLowerInvariant();
        normalized = Regex.Replace(normalized, @"[^\p{L}\p{N}]+", " ");
        return Regex.Replace(normalized, @"\s+", " ").Trim();
    }

    private static bool TryNormalizeIsbn13(string? value, out string isbn13)
    {
        isbn13 = string.Empty;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var digits = Regex.Replace(value, @"[\s\-]+", string.Empty);
        if (digits.Length == 13 &&
            digits.All(char.IsDigit) &&
            (digits.StartsWith("978", StringComparison.Ordinal) || digits.StartsWith("979", StringComparison.Ordinal)))
        {
            isbn13 = digits;
            return true;
        }

        return false;
    }

    private static bool IsIsbn13(string value) => TryNormalizeIsbn13(value, out _);

    private void ApplyMatch(Book book, HardcoverBookCandidate candidate, bool editionExplicitlyChosen)
    {
        var hadDifferentHardcoverBook = book.HardcoverBookId is { } previousBookId && previousBookId != candidate.BookId;
        var bookChanged = book.HardcoverBookId != candidate.BookId;
        if (bookChanged)
        {
            book.HardcoverUserBookId = null;
            book.HardcoverUserBookReadId = null;
            book.HardcoverLastSyncedAt = null;
            book.HardcoverSlug = null;
            book.HardcoverMatchedAt = UtcNow().UtcDateTime;
            if (hadDifferentHardcoverBook || book.HardcoverPendingFinishAfterReadId is >= 0)
            {
                book.HardcoverPendingFinishAfterReadId = null;
            }
            if (book.HardcoverPendingRatingBookId is { } ratedBookId && ratedBookId != candidate.BookId)
            {
                ClearPendingRating(book);
            }
        }
        else
        {
            book.HardcoverMatchedAt ??= UtcNow().UtcDateTime;
        }

        book.HardcoverBookId = candidate.BookId;
        book.HardcoverAutoMatchDisabled = false;
        var previousEditionId = book.HardcoverEditionId;
        if (bookChanged || editionExplicitlyChosen || !book.HardcoverEditionId.HasValue)
        {
            book.HardcoverEditionId = candidate.EditionId;
        }

        var editionChanged = previousEditionId != book.HardcoverEditionId;
        var pages = book.HardcoverEditionId is { } editionId
            ? candidate.Editions?.FirstOrDefault(edition => edition.EditionId == editionId)?.Pages
            : candidate.Pages;
        if (editionChanged || ((editionExplicitlyChosen || !book.PageCount.HasValue) && pages.HasValue))
        {
            book.PageCount = pages;
        }

        if (!string.IsNullOrWhiteSpace(candidate.Slug))
        {
            book.HardcoverSlug = Truncate(candidate.Slug!, 250);
        }

        if (IsEmptyOrUploadPlaceholder(book.Description) && !string.IsNullOrWhiteSpace(candidate.Description))
        {
            book.Description = Truncate(candidate.Description!, 1000);
        }
    }

    private bool HasMissingMetadata(Book book) =>
        IsEmptyOrUploadPlaceholder(book.Description) ||
        string.IsNullOrWhiteSpace(book.Author) ||
        string.IsNullOrWhiteSpace(book.Isbn13) ||
        string.IsNullOrWhiteSpace(book.Publisher) ||
        !book.ReleaseDate.HasValue ||
        !book.PageCount.HasValue ||
        string.IsNullOrWhiteSpace(book.CoverImagePath) ||
        IsMissingDownloadedCover(book.CoverImagePath);

    private async Task<List<string>> ApplyMissingMetadataAsync(
        Guid userId,
        Book book,
        HardcoverBookCandidate candidate,
        CancellationToken cancellationToken)
    {
        var changed = new List<string>();

        if (IsEmptyOrUploadPlaceholder(book.Description) && !string.IsNullOrWhiteSpace(candidate.Description))
        {
            book.Description = Truncate(candidate.Description!, 1000);
            changed.Add("description");
        }

        if (string.IsNullOrWhiteSpace(book.Author) && !string.IsNullOrWhiteSpace(candidate.Author))
        {
            book.Author = Truncate(candidate.Author!, 200);
            changed.Add("author");
        }

        if (string.IsNullOrWhiteSpace(book.Isbn13) && !string.IsNullOrWhiteSpace(candidate.Isbn13))
        {
            book.Isbn13 = Truncate(candidate.Isbn13!, 20);
            changed.Add("isbn13");
        }

        if (string.IsNullOrWhiteSpace(book.Publisher) && !string.IsNullOrWhiteSpace(candidate.Publisher))
        {
            book.Publisher = Truncate(candidate.Publisher!, 200);
            changed.Add("publisher");
        }

        if (!book.ReleaseDate.HasValue && candidate.ReleaseDate.HasValue)
        {
            book.ReleaseDate = candidate.ReleaseDate.Value;
            changed.Add("releaseDate");
        }

        if ((string.IsNullOrWhiteSpace(book.CoverImagePath) || IsMissingDownloadedCover(book.CoverImagePath)) &&
            !string.IsNullOrWhiteSpace(candidate.ImageUrl))
        {
            var coverPath = await DownloadCoverAsync(candidate.ImageUrl!, userId, book.BookId, cancellationToken);
            if (!string.IsNullOrWhiteSpace(coverPath))
            {
                book.CoverImagePath = coverPath;
                changed.Add("coverImage");
            }
        }

        var previousPageCount = book.PageCount;
        ApplyMatch(book, candidate, editionExplicitlyChosen: false);
        if (previousPageCount != book.PageCount) changed.Add("pageCount");
        return changed;
    }

    private static bool IsEmptyOrUploadPlaceholder(string? description)
    {
        if (string.IsNullOrWhiteSpace(description))
        {
            return true;
        }

        return description.TrimStart().StartsWith("Uploaded from ", StringComparison.Ordinal);
    }

    private static double CalculatePartCompletion(Book book)
    {
        if (book.IsFinished)
        {
            return 100;
        }

        var totalParts = book.Texts.Count;
        if (totalParts == 0)
        {
            return 0;
        }

        var allPartsFinished = book.Texts.All(t => t.IsFinished);
        if (allPartsFinished)
        {
            return 100;
        }

        var anyPartFinished = book.Texts.Any(t => t.IsFinished);
        if (!anyPartFinished)
        {
            return 0;
        }

        double completion;
        if (book.Texts.All(t => t.TotalWords > 0))
        {
            var totalWords = book.Texts.Sum(t => (double)t.TotalWords);
            var finishedWords = book.Texts.Where(t => t.IsFinished).Sum(t => (double)t.TotalWords);
            completion = Math.Round(finishedWords / totalWords * 100, 2);
        }
        else if (book.Texts.All(t => !string.IsNullOrEmpty(t.Content)))
        {
            var totalChars = book.Texts.Sum(t => (double)t.Content.Length);
            if (totalChars > 0)
            {
                var finishedChars = book.Texts.Where(t => t.IsFinished).Sum(t => (double)t.Content.Length);
                completion = Math.Round(finishedChars / totalChars * 100, 2);
            }
            else
            {
                var finished = book.Texts.Count(text => text.IsFinished);
                completion = Math.Round((double)finished / totalParts * 100, 2);
            }
        }
        else
        {
            var finished = book.Texts.Count(text => text.IsFinished);
            completion = Math.Round((double)finished / totalParts * 100, 2);
        }

        completion = Math.Min(completion, 99.99);
        completion = Math.Max(completion, 0.01);
        return completion;
    }

    private static int ResolveHardcoverStatus(double completion, bool isFinished)
    {
        if (isFinished || completion >= 100)
        {
            return ReadStatus;
        }

        return completion > 0 ? CurrentlyReadingStatus : WantToReadStatus;
    }

    private async Task<EnsureUserBookResult> EnsureUserBookAsync(
        Guid userId,
        string token,
        Book book,
        HardcoverUserBook? remote,
        int statusId,
        decimal? rating,
        CancellationToken cancellationToken)
    {
        var targetUserBookId = remote?.UserBookId ?? book.HardcoverUserBookId;
        if (targetUserBookId.HasValue)
        {
            try
            {
                var allowEditionSet = remote != null && !remote.EditionId.HasValue && book.HardcoverEditionId.HasValue;
                var lastReadDate = statusId == ReadStatus && remote?.StatusId != ReadStatus ? ResolveFinishedAtDate(book) : null;
                var updated = await UpdateUserBookAsync(
                    userId,
                    token,
                    targetUserBookId.Value,
                    statusId,
                    allowEditionSet ? book.HardcoverEditionId : null,
                    rating,
                    lastReadDate,
                    cancellationToken);

                var activeReadId = remote?.ActiveReadId ?? updated.ActiveReadId;
                var activeReadEditionId = remote?.ActiveReadEditionId ?? updated.ActiveReadEditionId;
                var updatedBook = new HardcoverUserBook(
                    targetUserBookId.Value,
                    statusId,
                    remote?.EditionId ?? updated.EditionId,
                    activeReadId,
                    activeReadEditionId,
                    remote?.ActiveReadProgressPages ?? updated.ActiveReadProgressPages,
                    remote?.CompletedReadId);
                return new EnsureUserBookResult(updatedBook, Skipped: false, SkipMessage: null, AlreadyFinishedOnHardcover: false, SkipReadUpsert: false);
            }
            catch (HardcoverApiException ex) when (IsRecoverableStaleRecordError(ex))
            {
                _logger.LogWarning(ex, "Cached HardcoverUserBookId {UserBookId} failed for book {BookId}; re-fetching.", targetUserBookId.Value, book.BookId);
                book.HardcoverUserBookId = null;

                var refetched = await FindUserBookAsync(userId, token, book, cancellationToken);
                if (refetched != null)
                {
                    var (shouldSkip, effectiveStatusId, alreadyFinished, skipMessage) =
                        EvaluateRemoteState(book, refetched, statusId, rating);

                    if (shouldSkip)
                    {
                        return new EnsureUserBookResult(refetched, Skipped: true, SkipMessage: skipMessage, AlreadyFinishedOnHardcover: alreadyFinished, SkipReadUpsert: true);
                    }

                    if (alreadyFinished && effectiveStatusId == ReadStatus && !rating.HasValue)
                    {
                        return new EnsureUserBookResult(refetched, Skipped: false, SkipMessage: null, AlreadyFinishedOnHardcover: true, SkipReadUpsert: true);
                    }

                    var allowEditionSet = !refetched.EditionId.HasValue && book.HardcoverEditionId.HasValue;
                    var lastReadDate = effectiveStatusId == ReadStatus && refetched.StatusId != ReadStatus
                        ? ResolveFinishedAtDate(book) : null;
                    var updated = await UpdateUserBookAsync(
                        userId,
                        token,
                        refetched.UserBookId,
                        effectiveStatusId,
                        allowEditionSet ? book.HardcoverEditionId : null,
                        rating,
                        lastReadDate,
                        cancellationToken);
                    var resolved = refetched with
                    {
                        StatusId = effectiveStatusId,
                        EditionId = refetched.EditionId ?? updated.EditionId,
                        ActiveReadId = refetched.ActiveReadId ?? updated.ActiveReadId,
                        ActiveReadEditionId = refetched.ActiveReadEditionId ?? updated.ActiveReadEditionId
                    };
                    var skipRead = alreadyFinished || (refetched.StatusId == ReadStatus && statusId < ReadStatus);
                    return new EnsureUserBookResult(resolved, Skipped: false, SkipMessage: null, AlreadyFinishedOnHardcover: alreadyFinished, SkipReadUpsert: skipRead);
                }
            }
        }

        const string mutation = """
            mutation InsertUserBook($object: UserBookCreateInput!) {
              insert_user_book(object: $object) {
                id
                error
                user_book {
                  id
                  status_id
                  edition_id
                  user_book_reads(limit: 1, order_by: { id: desc }) {
                    id
                    edition_id
                    finished_at
                    progress_pages
                  }
                }
              }
            }
            """;

        var today = UtcNow().UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var insertPayload = new UserBookCreatePayload
        {
            BookId = book.HardcoverBookId!.Value,
            EditionId = book.HardcoverEditionId,
            StatusId = statusId,
            DateAdded = today,
            Rating = rating,
            LastReadDate = statusId == ReadStatus ? ResolveFinishedAtDate(book) : null
        };

        var data = await ExecuteMutationAsync(userId, token, mutation, new { @object = insertPayload }, cancellationToken);
        var result = data.GetProperty("insert_user_book");
        ThrowIfMutationError(result);
        var userBookId = result.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.Number
            ? id.GetInt32()
            : result.GetProperty("user_book").GetProperty("id").GetInt32();

        var parsedRead = ParseMutationUserBookRead(result, preferUnfinished: statusId != ReadStatus);
        var insertedBook = new HardcoverUserBook(
            userBookId,
            statusId,
            book.HardcoverEditionId,
            parsedRead?.Id,
            parsedRead?.EditionId,
            parsedRead?.ProgressPages);
        return new EnsureUserBookResult(insertedBook, Skipped: false, SkipMessage: null, AlreadyFinishedOnHardcover: false, SkipReadUpsert: false);
    }

    private async Task<Dictionary<int, HardcoverUserBook>> FetchMyLibraryAsync(
        Guid userId,
        string token,
        IReadOnlyCollection<int> bookIds,
        CancellationToken cancellationToken)
    {
        var byBookId = new Dictionary<int, HardcoverUserBook>();
        var distinctIds = bookIds.Distinct().ToList();
        if (distinctIds.Count == 0)
        {
            return byBookId;
        }

        const string query = """
            query MyLibrary($bookIds: [Int!]) {
              me {
                user_books(where: { book_id: { _in: $bookIds } }) {
                  id
                  book_id
                  status_id
                  edition_id
                  user_book_reads(where: { finished_at: { _is_null: true } }, limit: 1, order_by: { id: desc }) {
                    id
                    edition_id
                    finished_at
                    progress_pages
                  }
                  completed_reads: user_book_reads(where: { finished_at: { _is_null: false } }, limit: 1, order_by: { id: desc }) { id }
                }
              }
            }
            """;

        foreach (var chunk in distinctIds.Chunk(LibraryBatchSize))
        {
            var data = await ExecuteGraphQlAsync(userId, token, query, new { bookIds = chunk }, cancellationToken);
            var me = GetMeElement(data);
            if (!me.TryGetProperty("user_books", out var userBooks) || userBooks.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var entry in userBooks.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var bookId = GetInt(entry, "book_id");
                var parsed = ParseUserBookElement(entry);
                if (bookId.HasValue && parsed != null)
                {
                    byBookId.TryAdd(bookId.Value, parsed);
                }
            }
        }

        return byBookId;
    }

    private async Task<HardcoverUserBook?> FindUserBookAsync(
        Guid userId,
        string token,
        Book book,
        CancellationToken cancellationToken)
    {
        const string query = """
            query UserBook($bookId: Int!, $pendingReadId: Int!) {
              me {
                user_books(where: { book_id: { _eq: $bookId } }, limit: 1) {
                  id
                  status_id
                  edition_id
                  user_book_reads(where: { finished_at: { _is_null: true } }, limit: 1, order_by: { id: desc }) {
                    id
                    edition_id
                    started_at
                    finished_at
                    progress_pages
                  }
                  completed_reads: user_book_reads(where: { finished_at: { _is_null: false } }, limit: 1, order_by: { id: desc }) { id }
                  completed_pending_read: user_book_reads(where: { id: { _eq: $pendingReadId }, finished_at: { _is_null: false } }, limit: 1) { id }
                }
              }
            }
            """;

        var pendingReadId = book.HardcoverPendingFinishAfterReadId is >= 0 ? book.HardcoverUserBookReadId.GetValueOrDefault() : 0;
        var data = await ExecuteGraphQlAsync(userId, token, query, new { bookId = book.HardcoverBookId!.Value, pendingReadId }, cancellationToken);
        var me = GetMeElement(data);
        if (!me.TryGetProperty("user_books", out var userBooks) || userBooks.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var userBook = userBooks.EnumerateArray().FirstOrDefault();
        if (userBook.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return ParseUserBookElement(userBook);
    }

    private static HardcoverUserBook? ParseUserBookElement(JsonElement userBook)
    {
        var userBookId = GetInt(userBook, "id");
        var statusId = GetInt(userBook, "status_id");
        if (!userBookId.HasValue || !statusId.HasValue)
        {
            return null;
        }

        var read = ParseActiveReadFromUserBook(userBook);
        var completedReadId = userBook.TryGetProperty("completed_reads", out var completed) &&
            completed.ValueKind == JsonValueKind.Array && completed.GetArrayLength() > 0 ? GetInt(completed[0], "id") : null;
        var completedPendingRead = userBook.TryGetProperty("completed_pending_read", out var pending) &&
            pending.ValueKind == JsonValueKind.Array && pending.GetArrayLength() > 0;
        return new HardcoverUserBook(
            userBookId.Value,
            statusId.Value,
            GetInt(userBook, "edition_id"),
            read?.Id,
            read?.EditionId,
            read?.ProgressPages,
            completedReadId,
            completedPendingRead);
    }

    private static ParsedReadEntry? ParseActiveReadFromUserBook(JsonElement userBook, bool preferUnfinished = true)
    {
        if (!userBook.TryGetProperty("user_book_reads", out var userBookReads) || userBookReads.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        ParsedReadEntry? fallback = null;
        foreach (var entry in userBookReads.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var id = GetInt(entry, "id");
            if (!id.HasValue)
            {
                continue;
            }

            var finishedAt = GetString(entry, "finished_at");
            var parsed = new ParsedReadEntry(
                id.Value,
                GetInt(entry, "edition_id"),
                GetInt(entry, "progress_pages"),
                finishedAt);

            fallback ??= parsed;
            if (!preferUnfinished || string.IsNullOrWhiteSpace(finishedAt))
            {
                return parsed;
            }
        }

        return preferUnfinished ? null : fallback;
    }

    private static ParsedReadEntry? ParseMutationUserBookRead(JsonElement mutationResult, bool preferUnfinished)
    {
        if (!mutationResult.TryGetProperty("user_book", out var userBook) || userBook.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return ParseActiveReadFromUserBook(userBook, preferUnfinished);
    }

    private async Task<HardcoverUserBook> UpdateUserBookAsync(
        Guid userId,
        string token,
        int userBookId,
        int statusId,
        int? editionIdToSet,
        decimal? rating,
        string? lastReadDate,
        CancellationToken cancellationToken)
    {
        const string mutation = """
            mutation UpdateUserBook($id: Int!, $object: UserBookUpdateInput!) {
              update_user_book(id: $id, object: $object) {
                id
                error
                user_book {
                  id
                  status_id
                  edition_id
                  user_book_reads(where: { finished_at: { _is_null: true } }, limit: 1, order_by: { id: desc }) {
                    id
                    edition_id
                    finished_at
                    progress_pages
                  }
                }
              }
            }
            """;

        var updatePayload = new UserBookUpdatePayload
        {
            StatusId = statusId,
            EditionId = editionIdToSet,
            Rating = rating,
            LastReadDate = lastReadDate
        };

        var data = await ExecuteMutationAsync(userId, token, mutation, new { id = userBookId, @object = updatePayload }, cancellationToken);
        var result = data.GetProperty("update_user_book");
        ThrowIfMutationError(result);

        var parsedRead = ParseMutationUserBookRead(result, preferUnfinished: true);
        int? updatedEditionId = result.TryGetProperty("user_book", out var ub) && ub.ValueKind == JsonValueKind.Object
            ? GetInt(ub, "edition_id")
            : editionIdToSet;

        return new HardcoverUserBook(
            userBookId,
            statusId,
            updatedEditionId,
            parsedRead?.Id,
            parsedRead?.EditionId,
            parsedRead?.ProgressPages);
    }

    private async Task<(int UserBookId, int? ReadId, int? ProgressPages)> UpsertUserBookReadAsync(
        Guid userId,
        string token,
        Book book,
        HardcoverUserBook userBook,
        double completion,
        bool finished,
        CancellationToken cancellationToken)
    {
        var finishedAt = finished ? ResolveFinishedAtDate(book) : null;
        var existingReadId = userBook.ActiveReadId;
        var editionId = userBook.ActiveReadEditionId ?? userBook.EditionId ?? book.HardcoverEditionId;
        var progressPages = EstimateProgressPages(book, completion, finished, editionId);

        if (existingReadId.HasValue)
        {
            try
            {
                var updatedId = await ExecuteUpdateUserBookReadAsync(
                    userId,
                    token,
                    existingReadId.Value,
                    !userBook.ActiveReadEditionId.HasValue ? editionId : null,
                    progressPages,
                    finishedAt,
                    cancellationToken);
                return (userBook.UserBookId, updatedId, progressPages);
            }
            catch (HardcoverApiException ex) when (IsRecoverableStaleRecordError(ex))
            {
                _logger.LogWarning(ex, "Cached HardcoverUserBookReadId {ReadId} failed for book {BookId}; re-fetching.", existingReadId.Value, book.BookId);

                var refetched = await FindUserBookAsync(userId, token, book, cancellationToken);
                if (refetched != null)
                {
                    userBook = refetched;
                    editionId = userBook.ActiveReadEditionId ?? userBook.EditionId ?? book.HardcoverEditionId;
                    progressPages = EstimateProgressPages(book, completion, finished, editionId);
                    if (userBook.ActiveReadId is { } activeReadId)
                    {
                        var updatedId = await ExecuteUpdateUserBookReadAsync(
                            userId,
                            token,
                            activeReadId,
                            !userBook.ActiveReadEditionId.HasValue ? editionId : null,
                            progressPages,
                            finishedAt,
                            cancellationToken);
                        return (userBook.UserBookId, updatedId, progressPages);
                    }

                    if (userBook.StatusId == ReadStatus && (!finished || HasFinishedRead(book, userBook)))
                    {
                        return (userBook.UserBookId, null, null);
                    }
                }
            }
        }

        const string insertMutation = """
            mutation InsertUserBookRead($userBookId: Int!, $userBookRead: DatesReadInput!) {
              insert_user_book_read(user_book_id: $userBookId, user_book_read: $userBookRead) {
                id
                error
                user_book_read { id }
              }
            }
            """;

        var startedAtDate = ResolveStartedAtDate(book);
        var insertPayload = new DatesReadInsertPayload
        {
            EditionId = editionId,
            ProgressPages = progressPages,
            StartedAt = startedAtDate,
            FinishedAt = finishedAt
        };

        var userBookId = userBook.UserBookId;
        var insertData = await ExecuteMutationAsync(userId, token, insertMutation, new { userBookId, userBookRead = insertPayload }, cancellationToken);
        var insertResult = insertData.GetProperty("insert_user_book_read");
        ThrowIfMutationError(insertResult);
        var readId = insertResult.TryGetProperty("id", out var insertedId) && insertedId.ValueKind == JsonValueKind.Number
            ? insertedId.GetInt32()
            : insertResult.GetProperty("user_book_read").GetProperty("id").GetInt32();
        return (userBookId, readId, progressPages);
    }

    private async Task<int> ExecuteUpdateUserBookReadAsync(
        Guid userId,
        string token,
        int readId,
        int? editionIdToSet,
        int? progressPages,
        string? finishedAt,
        CancellationToken cancellationToken)
    {
        if (editionIdToSet == null && progressPages == null && finishedAt == null) return readId;

        const string updateMutation = """
            mutation UpdateUserBookRead($id: Int!, $object: DatesReadInput!) {
              update_user_book_read(id: $id, object: $object) {
                id
                error
                user_book_read { id }
              }
            }
            """;

        var updatePayload = new DatesReadUpdatePayload
        {
            EditionId = editionIdToSet,
            ProgressPages = progressPages,
            FinishedAt = finishedAt
        };

        var data = await ExecuteMutationAsync(userId, token, updateMutation, new { id = readId, @object = updatePayload }, cancellationToken);
        var result = data.GetProperty("update_user_book_read");
        ThrowIfMutationError(result);
        return result.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.Number
            ? id.GetInt32()
            : readId;
    }

    private string ResolveFinishedAtDate(Book book)
    {
        var completedTexts = book.Texts.Where(text => text.IsFinished);
        if (book.IsRereading && book.RereadStartedAt is { } rereadStartedAt)
        {
            var priorPassAt = completedTexts
                .Where(text => text.LastCompletedAt <= rereadStartedAt)
                .Max(text => text.LastCompletedAt);
            return (priorPassAt ?? rereadStartedAt).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        var completedAt = completedTexts.Max(text => text.LastCompletedAt);
        return (completedAt ?? book.LastReadAt ?? UtcNow().UtcDateTime).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    private string ResolveStartedAtDate(Book book)
    {
        var earliestPartCompletion = book.Texts
            .Where(t => t.LastCompletedAt.HasValue)
            .Select(t => t.LastCompletedAt!.Value)
            .DefaultIfEmpty()
            .Min();

        var started = earliestPartCompletion != default
            ? earliestPartCompletion
            : (book.LastReadAt ?? UtcNow().UtcDateTime);

        return started.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    private static bool IsRecoverableStaleRecordError(HardcoverApiException ex)
    {
        if (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return true;
        }

        if (ex.StatusCode != HttpStatusCode.OK || string.IsNullOrWhiteSpace(ex.Message))
        {
            return false;
        }

        return ex.Message.Contains("not found", StringComparison.OrdinalIgnoreCase) ||
               ex.Message.Contains("does not exist", StringComparison.OrdinalIgnoreCase) ||
               ex.Message.Contains("cannot find", StringComparison.OrdinalIgnoreCase) ||
               ex.Message.Contains("no record", StringComparison.OrdinalIgnoreCase);
    }

    // Every write to the user's Hardcover account goes through here. The sync entry points already
    // return early when external writes are disabled; this is the backstop for any new caller.
    private Task<JsonElement> ExecuteMutationAsync(Guid userId, string token, string mutation, object? variables, CancellationToken cancellationToken)
    {
        if (_externalWritesDisabled)
        {
            throw new InvalidOperationException("Hardcover writes: " + ExternalWritesOptions.DisabledMessage);
        }

        return ExecuteGraphQlAsync(userId, token, mutation, variables, cancellationToken, allowTransientRetry: false);
    }

    private async Task<JsonElement> ExecuteGraphQlAsync(
        Guid userId,
        string token,
        string query,
        object? variables,
        CancellationToken cancellationToken,
        bool allowTransientRetry = true)
    {
        var normalizedToken = NormalizeToken(token);
        var tokenFingerprint = ComputeTokenFingerprint(normalizedToken);
        var payloadJson = JsonSerializer.Serialize(new { query, variables }, JsonOptions);
        DateTimeOffset? alreadyWaitedUntil = null;

        for (var attempt = 0; attempt < 3; attempt++)
        {
            var effectiveNow = UtcNow();
            if (alreadyWaitedUntil.HasValue && alreadyWaitedUntil.Value > effectiveNow)
            {
                effectiveNow = alreadyWaitedUntil.Value;
            }

            var preDelay = _rateLimiter.GetRequiredDelay(userId, effectiveNow, out var isDailyExhausted, out var dailyResetSeconds, tokenFingerprint);
            if (isDailyExhausted)
            {
                throw new HardcoverApiException(
                    "Hardcover daily API request limit reached. Try again after midnight UTC.",
                    HttpStatusCode.TooManyRequests,
                    "daily_rate_limit",
                    retryAfterSeconds: dailyResetSeconds);
            }

            if (preDelay > TimeSpan.Zero)
            {
                if (preDelay > TimeSpan.FromSeconds(MaxRateLimitWaitSeconds))
                {
                    var waitSeconds = (int)Math.Ceiling(preDelay.TotalSeconds);
                    throw new HardcoverApiException(
                        $"Hardcover API rate limit reached. Try again in {waitSeconds}s.",
                        HttpStatusCode.TooManyRequests,
                        "rate_limit",
                        retryAfterSeconds: waitSeconds);
                }

                alreadyWaitedUntil = effectiveNow + preDelay;
                await DelayAsync(preDelay, cancellationToken);
            }

            var httpClient = _httpClientFactory.CreateClient(ApiClientName);
            var requestUri = httpClient.BaseAddress != null ? "v1/graphql" : Endpoint;

            using var request = new HttpRequestMessage(HttpMethod.Post, requestUri);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", normalizedToken);
            if (request.Headers.UserAgent.Count == 0 && httpClient.DefaultRequestHeaders.UserAgent.Count == 0)
            {
                request.Headers.UserAgent.ParseAdd(UserAgent);
            }
            request.Content = new StringContent(payloadJson, Encoding.UTF8, "application/json");

            var requestStartedUtc = UtcNow();
            HttpResponseMessage response;
            try
            {
                response = await httpClient.SendAsync(request, cancellationToken);
            }
            catch (HttpRequestException ex)
            {
                throw new HardcoverApiException(
                    "Could not reach Hardcover API.",
                    HttpStatusCode.BadGateway,
                    "network_error",
                    innerException: ex);
            }
            catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
            {
                throw new HardcoverApiException(
                    "Hardcover API request timed out.",
                    HttpStatusCode.GatewayTimeout,
                    "timeout",
                    innerException: ex);
            }

            using (response)
            {
                string responseBody;
                try
                {
                    responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
                }
                catch (HttpRequestException ex)
                {
                    throw new HardcoverApiException(
                        "Could not reach Hardcover API.",
                        HttpStatusCode.BadGateway,
                        "network_error",
                        innerException: ex);
                }
                catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
                {
                    throw new HardcoverApiException(
                        "Hardcover API request timed out.",
                        HttpStatusCode.GatewayTimeout,
                        "timeout",
                        innerException: ex);
                }

                var responseNow = UtcNow();
                _rateLimiter.RecordResponse(
                    userId,
                    response.Headers,
                    response.StatusCode,
                    responseNow,
                    requestStartedUtc,
                    tokenFingerprint);

                if (response.IsSuccessStatusCode)
                {
                    JsonDocument document;
                    try
                    {
                        document = JsonDocument.Parse(responseBody);
                    }
                    catch (JsonException ex)
                    {
                        throw new HardcoverApiException(
                            "Hardcover returned an invalid response.",
                            HttpStatusCode.BadGateway,
                            "invalid_response",
                            innerException: ex);
                    }

                    using (document)
                    {
                        if (document.RootElement.ValueKind != JsonValueKind.Object)
                        {
                            throw new HardcoverApiException(
                                "Hardcover returned an invalid response.",
                                HttpStatusCode.BadGateway,
                                "invalid_response");
                        }

                        if (document.RootElement.TryGetProperty("errors", out var errors) &&
                            errors.ValueKind == JsonValueKind.Array &&
                            errors.GetArrayLength() > 0)
                        {
                            var message = errors[0].ValueKind == JsonValueKind.Object &&
                                          errors[0].TryGetProperty("message", out var errorMessage)
                                ? errorMessage.GetString()
                                : "Unknown GraphQL error";
                            throw new HardcoverApiException($"Hardcover GraphQL error: {message}", HttpStatusCode.OK, "graphql_error");
                        }

                        if (!document.RootElement.TryGetProperty("data", out var dataElement) ||
                            dataElement.ValueKind != JsonValueKind.Object)
                        {
                            throw new HardcoverApiException(
                                "Hardcover API returned a response without a data payload.",
                                HttpStatusCode.BadGateway,
                                "invalid_response");
                        }

                        return dataElement.Clone();
                    }
                }

                var parsedError = ParseApiError(response.StatusCode, response.ReasonPhrase, response.Headers, responseBody, responseNow);

                if (attempt < 2)
                {
                    TimeSpan? retryDelay = null;
                    if (response.StatusCode == HttpStatusCode.TooManyRequests &&
                        !string.Equals(parsedError.ErrorCode, "daily_rate_limit", StringComparison.Ordinal))
                    {
                        var retrySeconds = parsedError.RetryAfterSeconds;
                        if (!retrySeconds.HasValue)
                        {
                            retrySeconds = attempt == 0 ? 2 : 4;
                        }

                        if (retrySeconds.Value <= MaxRateLimitWaitSeconds)
                        {
                            retryDelay = TimeSpan.FromSeconds(Math.Max(1, retrySeconds.Value));
                        }
                    }
                    else if (allowTransientRetry &&
                             response.StatusCode is HttpStatusCode.ServiceUnavailable or HttpStatusCode.RequestTimeout)
                    {
                        retryDelay = TimeSpan.FromSeconds(attempt == 0 ? 1 : 2);
                    }

                    if (retryDelay.HasValue)
                    {
                        var baseTime = alreadyWaitedUntil.HasValue && alreadyWaitedUntil.Value > responseNow
                            ? alreadyWaitedUntil.Value
                            : responseNow;
                        alreadyWaitedUntil = baseTime + retryDelay.Value;
                        await DelayAsync(retryDelay.Value, cancellationToken);
                        continue;
                    }
                }

                throw parsedError;
            }
        }

        throw new HardcoverApiException("Hardcover API request failed after retries.");
    }

    private static HardcoverApiException ParseApiError(
        HttpStatusCode statusCode,
        string? reasonPhrase,
        HttpResponseHeaders headers,
        string responseBody,
        DateTimeOffset now)
    {
        string? errorCode = null;
        string? errorDescription = null;
        string? message = null;
        string? missingScope = null;
        string? firstArrayError = null;

        if (!string.IsNullOrWhiteSpace(responseBody))
        {
            try
            {
                using var doc = JsonDocument.Parse(responseBody);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    errorCode = GetString(doc.RootElement, "error");
                    errorDescription = GetString(doc.RootElement, "error_description");
                    message = GetString(doc.RootElement, "message");
                    missingScope = GetString(doc.RootElement, "scope");

                    if (doc.RootElement.TryGetProperty("errors", out var errorsArray) &&
                        errorsArray.ValueKind == JsonValueKind.Array &&
                        errorsArray.GetArrayLength() > 0)
                    {
                        var first = errorsArray[0];
                        firstArrayError = first.ValueKind == JsonValueKind.String
                            ? first.GetString()
                            : (first.ValueKind == JsonValueKind.Object ? GetString(first, "message") : null);
                    }
                }
            }
            catch (JsonException)
            {
                // Response body is plain text or HTML (e.g., edge proxy error).
            }
        }

        var retryAfterSeconds = HardcoverRateLimiter.ParseRetryAfterSeconds(headers, now);

        if (statusCode == HttpStatusCode.Unauthorized)
        {
            return new HardcoverApiException(
                "Hardcover API token is invalid or expired. Generate a new token in Hardcover settings.",
                statusCode,
                errorCode ?? "invalid_token");
        }

        if (statusCode == HttpStatusCode.Forbidden)
        {
            if (string.Equals(errorCode, "insufficient_scope", StringComparison.OrdinalIgnoreCase))
            {
                var msg = !string.IsNullOrWhiteSpace(missingScope)
                    ? $"Hardcover API token is missing the required '{missingScope}' permission. Generate a new token with the required scopes."
                    : "Hardcover API token is missing required permissions. Generate a new token with the required scopes.";
                return new HardcoverApiException(msg, statusCode, "insufficient_scope", missingScope);
            }

            if (string.Equals(errorCode, "request_exceeds_capacity", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(firstArrayError, "request_exceeds_capacity", StringComparison.OrdinalIgnoreCase))
            {
                return new HardcoverApiException(
                    "Hardcover API request exceeded burst capacity.",
                    statusCode,
                    "request_exceeds_capacity");
            }

            if (string.Equals(errorCode, "unsupported_operation", StringComparison.OrdinalIgnoreCase))
            {
                return new HardcoverApiException(
                    "Hardcover API does not permit this operation with an API token.",
                    statusCode,
                    "unsupported_operation");
            }

            var detail = errorDescription ?? message ?? errorCode ?? firstArrayError;
            return new HardcoverApiException(
                !string.IsNullOrWhiteSpace(detail) ? $"Hardcover API access denied: {detail}" : "Hardcover API denied access (403 Forbidden).",
                statusCode,
                errorCode ?? "forbidden");
        }

        if (statusCode == HttpStatusCode.TooManyRequests)
        {
            var buckets = headers.TryGetValues("RateLimit", out var rateLimitValues)
                ? HardcoverRateLimiter.ParseRateLimitHeader(rateLimitValues)
                : Array.Empty<HardcoverRateLimitBucket>();

            var dailyBucket = buckets.FirstOrDefault(b =>
                string.Equals(b.Name, "daily", StringComparison.OrdinalIgnoreCase) &&
                b.Remaining is <= 0);
            if (dailyBucket != null)
            {
                var dailyResetSeconds = dailyBucket.ResetSeconds switch
                {
                    > 0 => dailyBucket.ResetSeconds.Value,
                    0 => 2,
                    _ => retryAfterSeconds ?? 3600
                };
                return new HardcoverApiException(
                    "Hardcover daily API request limit reached. Try again after midnight UTC.",
                    statusCode,
                    "daily_rate_limit",
                    retryAfterSeconds: dailyResetSeconds);
            }

            if (!retryAfterSeconds.HasValue)
            {
                var nonDailyReset = buckets
                    .Where(b => !string.Equals(b.Name, "daily", StringComparison.OrdinalIgnoreCase) &&
                                b.ResetSeconds is > 0 &&
                                b.Remaining is null or <= 1)
                    .Select(b => b.ResetSeconds!.Value)
                    .DefaultIfEmpty()
                    .Max();
                if (nonDailyReset > 0)
                {
                    retryAfterSeconds = Math.Clamp(nonDailyReset, 1, 300);
                }
            }
            else
            {
                retryAfterSeconds = Math.Clamp(retryAfterSeconds.Value, 1, 300);
            }

            var msg = retryAfterSeconds.HasValue
                ? $"Hardcover API rate limit reached. Try again in {retryAfterSeconds.Value}s."
                : "Hardcover API rate limit reached. Try again shortly.";
            return new HardcoverApiException(msg, statusCode, "rate_limit", retryAfterSeconds: retryAfterSeconds);
        }

        if (statusCode == HttpStatusCode.RequestTimeout)
        {
            return new HardcoverApiException("Hardcover API request timed out (408).", statusCode, "timeout");
        }

        if (statusCode == HttpStatusCode.ServiceUnavailable)
        {
            return new HardcoverApiException("Hardcover API is temporarily unavailable (503). Please try again later.", statusCode, "service_unavailable");
        }

        var genericDetail = errorDescription ?? message ?? errorCode ?? firstArrayError;
        var genericMessage = !string.IsNullOrWhiteSpace(genericDetail)
            ? $"Hardcover API error ({(int)statusCode}): {genericDetail}"
            : $"Hardcover API error: {(int)statusCode} {reasonPhrase}";
        return new HardcoverApiException(genericMessage, statusCode, errorCode);
    }

    private static JsonElement GetMeElement(JsonElement data)
    {
        if (!data.TryGetProperty("me", out var me))
        {
            throw new HardcoverApiException("Hardcover API did not return the current user.", HttpStatusCode.BadGateway, "invalid_response");
        }

        if (me.ValueKind == JsonValueKind.Object)
        {
            return me;
        }

        if (me.ValueKind == JsonValueKind.Array)
        {
            var firstUser = me.EnumerateArray().FirstOrDefault();
            if (firstUser.ValueKind == JsonValueKind.Object)
            {
                return firstUser;
            }
        }

        throw new HardcoverApiException("Hardcover API did not return the current user.", HttpStatusCode.BadGateway, "invalid_response");
    }

    private static string NormalizeToken(string token)
    {
        var trimmed = token.Trim(' ', '\t');
        if (trimmed.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = trimmed["Bearer ".Length..].Trim(' ', '\t');
        }

        if (trimmed.Length == 0)
        {
            throw new HardcoverConfigurationException("Hardcover API token is not configured.");
        }

        foreach (var c in trimmed)
        {
            if (c < 0x21 || c > 0x7E)
            {
                throw new HardcoverConfigurationException("Hardcover API token contains invalid characters.");
            }
        }

        return trimmed;
    }

    private static string ComputeTokenFingerprint(string normalizedToken)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalizedToken));
        return Convert.ToHexString(hash.AsSpan(0, 8));
    }

    private async Task<string?> DownloadCoverAsync(string imageUrl, Guid userId, int bookId, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return null;
        }

        string? tempPath = null;
        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(CoverDownloadTimeout);
            var downloadToken = timeoutCts.Token;

            var httpClient = _httpClientFactory.CreateClient("HardcoverCover");
            using var response = await httpClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, downloadToken);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var mediaType = response.Content.Headers.ContentType?.MediaType;
            if (!string.IsNullOrWhiteSpace(mediaType) &&
                (!mediaType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(mediaType, "image/svg+xml", StringComparison.OrdinalIgnoreCase)))
            {
                _logger.LogWarning("Hardcover cover for book {BookId} returned disallowed content type {MediaType}.", bookId, mediaType);
                return null;
            }

            if (response.Content.Headers.ContentLength > MaxCoverBytes)
            {
                _logger.LogWarning("Hardcover cover for book {BookId} exceeds max size ({Length} bytes).", bookId, response.Content.Headers.ContentLength);
                return null;
            }

            await using var contentStream = await response.Content.ReadAsStreamAsync(downloadToken);
            using var buffer = new MemoryStream();
            var chunk = new byte[16384];
            int bytesRead;
            while ((bytesRead = await contentStream.ReadAsync(chunk, downloadToken)) > 0)
            {
                if (buffer.Length + bytesRead > MaxCoverBytes)
                {
                    _logger.LogWarning("Hardcover cover stream for book {BookId} exceeded {MaxBytes} byte limit.", bookId, MaxCoverBytes);
                    return null;
                }

                buffer.Write(chunk, 0, bytesRead);
            }

            if (buffer.Length == 0)
            {
                return null;
            }

            var extension = ImageFileExtension.From(uri.AbsolutePath, mediaType);
            if (string.Equals(extension, ".svg", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Hardcover cover for book {BookId} resolved to disallowed .svg extension.", bookId);
                return null;
            }

            var webRoot = GetWebRootPath();
            var relativeDirectory = Path.Combine("hardcover-covers", userId.ToString("N"));
            var absoluteDirectory = Path.Combine(webRoot, relativeDirectory);
            Directory.CreateDirectory(absoluteDirectory);

            var fileName = $"{bookId}{extension}";
            var absolutePath = Path.Combine(absoluteDirectory, fileName);
            tempPath = Path.Combine(absoluteDirectory, $"{bookId}.{Guid.NewGuid():N}.tmp");

            await File.WriteAllBytesAsync(tempPath, buffer.ToArray(), downloadToken);
            File.Move(tempPath, absolutePath, overwrite: true);
            tempPath = null;

            BookAssetStorage.DeleteCoverImages(webRoot, userId, bookId, _logger, exceptFilePath: absolutePath);

            return Path.Combine(relativeDirectory, fileName).Replace('\\', '/');
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "Failed to download Hardcover cover for book {BookId}", bookId);
            return null;
        }
        finally
        {
            if (tempPath != null)
            {
                try
                {
                    if (File.Exists(tempPath))
                    {
                        File.Delete(tempPath);
                    }
                }
                catch (Exception cleanupEx)
                {
                    _logger.LogWarning(cleanupEx, "Failed to clean up temporary cover file {TempPath}", tempPath);
                }
            }
        }
    }

    // A cover this service downloaded whose file is gone. Before hardcover-covers had its own
    // volume, every redeploy dropped these files while the book kept pointing at them; downloading
    // again heals the book. Covers from anywhere else (EPUB covers) are never replaced here.
    private bool IsMissingDownloadedCover(string coverImagePath) =>
        coverImagePath.StartsWith("hardcover-covers/", StringComparison.Ordinal) &&
        !File.Exists(Path.Combine(GetWebRootPath(), coverImagePath.Replace('/', Path.DirectorySeparatorChar)));

    private string GetWebRootPath()
    {
        var webRoot = _environment.WebRootPath;
        if (!string.IsNullOrWhiteSpace(webRoot))
        {
            Directory.CreateDirectory(webRoot);
            return webRoot;
        }

        var fallback = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
        Directory.CreateDirectory(fallback);
        return fallback;
    }

    private static string? GetImageUrl(JsonElement element)
    {
        return element.TryGetProperty("image", out var image) && image.ValueKind == JsonValueKind.Object
            ? GetString(image, "url")
            : null;
    }

    private static string? GetString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private static int? GetInt(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var result)
            ? result
            : null;
    }

    internal static DateTime? ParseDate(string? value)
    {
        return DateTime.TryParse(
                value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var date)
            ? DateTime.SpecifyKind(date.Date, DateTimeKind.Utc)
            : null;
    }

    private static string Truncate(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private static void ThrowIfMutationError(JsonElement result)
    {
        if (result.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(error.GetString()))
        {
            throw new HardcoverApiException(error.GetString()!, HttpStatusCode.OK, "mutation_error");
        }
    }

    private sealed class UserBookCreatePayload
    {
        [JsonPropertyName("book_id")]
        public int BookId { get; init; }

        [JsonPropertyName("edition_id")]
        public int? EditionId { get; init; }

        [JsonPropertyName("status_id")]
        public int StatusId { get; init; }

        [JsonPropertyName("date_added")]
        public string DateAdded { get; init; } = string.Empty;

        [JsonPropertyName("rating")]
        public decimal? Rating { get; init; }

        [JsonPropertyName("last_read_date")]
        public string? LastReadDate { get; init; }
    }

    private sealed class UserBookUpdatePayload
    {
        [JsonPropertyName("status_id")]
        public int StatusId { get; init; }

        [JsonPropertyName("edition_id")]
        public int? EditionId { get; init; }

        [JsonPropertyName("rating")]
        public decimal? Rating { get; init; }

        [JsonPropertyName("last_read_date")]
        public string? LastReadDate { get; init; }
    }

    private sealed class DatesReadInsertPayload
    {
        [JsonPropertyName("edition_id")]
        public int? EditionId { get; init; }

        [JsonPropertyName("progress_pages")]
        public int? ProgressPages { get; init; }

        [JsonPropertyName("started_at")]
        public string StartedAt { get; init; } = string.Empty;

        [JsonPropertyName("finished_at")]
        public string? FinishedAt { get; init; }
    }

    private sealed class DatesReadUpdatePayload
    {
        [JsonPropertyName("edition_id")]
        public int? EditionId { get; init; }

        [JsonPropertyName("progress_pages")]
        public int? ProgressPages { get; init; }

        [JsonPropertyName("finished_at")]
        public string? FinishedAt { get; init; }
    }

    private sealed record EnsureUserBookResult(
        HardcoverUserBook UserBook,
        bool Skipped,
        string? SkipMessage,
        bool AlreadyFinishedOnHardcover,
        bool SkipReadUpsert);

    private sealed record RawHardcoverBook(
        int Id,
        string Title,
        string? Slug,
        string? Description,
        string? Author,
        IReadOnlyList<string> Authors,
        DateTime? ReleaseDate,
        int? Pages,
        string? ImageUrl,
        int UsersCount,
        IReadOnlyList<RawHardcoverEdition> Editions);

    private sealed record RawHardcoverEdition(
        int EditionId,
        string? Title,
        string? Language,
        string? LanguageCode2,
        string? LanguageCode3,
        string? Format,
        int? ReadingFormatId,
        int? Pages,
        string? Isbn13,
        string? Publisher,
        DateTime? ReleaseDate,
        string? ImageUrl)
    {
        public string? LanguageCode => LanguageCode2 ?? LanguageCode3;
    }

    private sealed record ParsedReadEntry(int Id, int? EditionId, int? ProgressPages, string? FinishedAt);
}

public sealed record HardcoverConnectionResult(
    bool Configured,
    bool Connected,
    bool SyncEnabled,
    int? HardcoverUserId,
    string? Username,
    string Message);

public sealed record HardcoverMatchResult(
    bool Applied,
    HardcoverBookCandidate? AppliedCandidate,
    IReadOnlyList<HardcoverBookCandidate> Candidates,
    string Message);

public sealed record HardcoverMetadataImportResult(
    bool Success,
    IReadOnlyList<string> UpdatedFields,
    IReadOnlyList<HardcoverBookCandidate> Candidates,
    string Message);

public sealed record HardcoverProgressSyncResult(
    int BookId,
    bool Success,
    bool Skipped,
    double CompletionPercentage,
    int? StatusId,
    int? ProgressPages,
    string Message)
{
    public static HardcoverProgressSyncResult SkippedResult(int bookId, string message) =>
        new(bookId, false, true, 0, null, null, message);
}

public sealed record HardcoverSyncAllResult(
    IReadOnlyList<HardcoverProgressSyncResult> Results,
    string Message);

public sealed record HardcoverEditionOption(
    int EditionId,
    string? Title,
    string? Language,
    string? LanguageCode,
    string? Format,
    int? Pages,
    string? Isbn13,
    string? Publisher,
    string? ImageUrl);

public sealed record HardcoverBookCandidate(
    int BookId,
    int? EditionId,
    string Title,
    string? Slug,
    string? Description,
    string? Author,
    string? Isbn13,
    string? Publisher,
    DateTime? ReleaseDate,
    int? Pages,
    string? ImageUrl,
    double Score,
    IReadOnlyList<HardcoverEditionOption>? Editions = null)
{
    [JsonIgnore]
    internal IReadOnlyList<string> PrimaryAuthors { get; init; } = Array.Empty<string>();
}

internal sealed record HardcoverUser(int Id, string? Username);

internal sealed record HardcoverUserBook(
    int UserBookId,
    int StatusId,
    int? EditionId,
    int? ActiveReadId,
    int? ActiveReadEditionId,
    int? ActiveReadProgressPages,
    int? CompletedReadId = null,
    bool CompletedPendingRead = false);
