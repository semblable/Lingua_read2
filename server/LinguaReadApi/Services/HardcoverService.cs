using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services;

public interface IHardcoverService
{
    Task<HardcoverConnectionResult> GetStatusAsync(Guid userId, CancellationToken cancellationToken = default);
    Task<HardcoverMatchResult> MatchBookAsync(Guid userId, int bookId, int? hardcoverBookId = null, CancellationToken cancellationToken = default);
    Task<HardcoverMetadataImportResult> ImportMetadataAsync(Guid userId, int bookId, CancellationToken cancellationToken = default);
    Task<HardcoverProgressSyncResult> SyncProgressAsync(Guid userId, int bookId, bool requireSyncEnabled = false, CancellationToken cancellationToken = default);
    Task<HardcoverSyncAllResult> SyncAllAsync(Guid userId, CancellationToken cancellationToken = default);
}

public sealed class HardcoverService : IHardcoverService
{
    private const string Endpoint = "https://api.hardcover.app/v1/graphql";
    private const int WantToReadStatus = 1;
    private const int CurrentlyReadingStatus = 2;
    private const int ReadStatus = 3;
    private const double AutoMatchThreshold = 0.92;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private readonly AppDbContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<HardcoverService> _logger;

    public HardcoverService(
        AppDbContext context,
        IHttpClientFactory httpClientFactory,
        IWebHostEnvironment environment,
        ILogger<HardcoverService> logger)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _environment = environment;
        _logger = logger;
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
            var user = await GetMeAsync(settings.HardcoverApiToken, cancellationToken);
            return new HardcoverConnectionResult(true, true, settings.HardcoverSyncEnabled, user.Id, user.Username, "Connection successful.");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Hardcover status check failed for user {UserId}", userId);
            return new HardcoverConnectionResult(true, false, settings.HardcoverSyncEnabled, null, null, ex.Message);
        }
    }

    public async Task<HardcoverMatchResult> MatchBookAsync(Guid userId, int bookId, int? hardcoverBookId = null, CancellationToken cancellationToken = default)
    {
        var settings = await RequireSettingsWithTokenAsync(userId, cancellationToken);
        var book = await GetOwnedBookAsync(userId, bookId, includeTexts: false, cancellationToken);

        var candidates = hardcoverBookId.HasValue
            ? await FindBooksByIdsAsync(settings.HardcoverApiToken!, new[] { hardcoverBookId.Value }, cancellationToken)
            : await FindCandidatesAsync(settings.HardcoverApiToken!, book, cancellationToken);

        var scored = candidates
            .Select(candidate => candidate with { Score = hardcoverBookId.HasValue ? 1.0 : ScoreCandidate(book, candidate) })
            .OrderByDescending(candidate => candidate.Score)
            .ToList();

        var best = scored.FirstOrDefault();
        if (best == null)
        {
            return new HardcoverMatchResult(false, null, Array.Empty<HardcoverBookCandidate>(), "No Hardcover candidates found.");
        }

        if (!hardcoverBookId.HasValue && best.Score < AutoMatchThreshold)
        {
            return new HardcoverMatchResult(false, null, scored, "No high-confidence match found. Please review candidates.");
        }

        ApplyMatch(book, best);
        await _context.SaveChangesAsync(cancellationToken);

        return new HardcoverMatchResult(true, best, scored, "Matched Hardcover book.");
    }

    public async Task<HardcoverMetadataImportResult> ImportMetadataAsync(Guid userId, int bookId, CancellationToken cancellationToken = default)
    {
        var settings = await RequireSettingsWithTokenAsync(userId, cancellationToken);
        var book = await GetOwnedBookAsync(userId, bookId, includeTexts: false, cancellationToken);

        HardcoverBookCandidate? candidate = null;
        if (book.HardcoverBookId.HasValue)
        {
            candidate = (await FindBooksByIdsAsync(settings.HardcoverApiToken!, new[] { book.HardcoverBookId.Value }, cancellationToken)).FirstOrDefault();
        }

        if (candidate == null)
        {
            var match = await MatchBookAsync(userId, bookId, null, cancellationToken);
            if (!match.Applied || match.AppliedCandidate == null)
            {
                return new HardcoverMetadataImportResult(false, Array.Empty<string>(), match.Candidates, match.Message);
            }

            candidate = match.AppliedCandidate;
            book = await GetOwnedBookAsync(userId, bookId, includeTexts: false, cancellationToken);
        }

        var changed = new List<string>();

        if (string.IsNullOrWhiteSpace(book.Description) && !string.IsNullOrWhiteSpace(candidate.Description))
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

        if (!book.PageCount.HasValue && candidate.Pages.HasValue)
        {
            book.PageCount = candidate.Pages.Value;
            changed.Add("pageCount");
        }

        if (string.IsNullOrWhiteSpace(book.CoverImagePath) && !string.IsNullOrWhiteSpace(candidate.ImageUrl))
        {
            var coverPath = await DownloadCoverAsync(candidate.ImageUrl!, userId, book.BookId, cancellationToken);
            if (!string.IsNullOrWhiteSpace(coverPath))
            {
                book.CoverImagePath = coverPath;
                changed.Add("coverImage");
            }
        }

        ApplyMatch(book, candidate);
        await _context.SaveChangesAsync(cancellationToken);

        return new HardcoverMetadataImportResult(true, changed, new[] { candidate }, changed.Count == 0 ? "No missing metadata to import." : "Imported Hardcover metadata.");
    }

    public async Task<HardcoverProgressSyncResult> SyncProgressAsync(Guid userId, int bookId, bool requireSyncEnabled = false, CancellationToken cancellationToken = default)
    {
        var settings = await RequireSettingsWithTokenAsync(userId, cancellationToken);
        if (requireSyncEnabled && !settings.HardcoverSyncEnabled)
        {
            return HardcoverProgressSyncResult.SkippedResult(bookId, "Hardcover sync is disabled.");
        }

        var book = await GetOwnedBookAsync(userId, bookId, includeTexts: true, cancellationToken);
        if (!book.HardcoverBookId.HasValue)
        {
            var match = await MatchBookAsync(userId, bookId, null, cancellationToken);
            if (!match.Applied)
            {
                return HardcoverProgressSyncResult.SkippedResult(bookId, match.Message);
            }

            book = await GetOwnedBookAsync(userId, bookId, includeTexts: true, cancellationToken);
        }

        var completion = CalculatePartCompletion(book);
        var statusId = ResolveHardcoverStatus(completion, book.IsFinished);
        var userBook = await EnsureUserBookAsync(settings.HardcoverApiToken!, book, statusId, cancellationToken);

        int? estimatedProgressPages = null;
        var pages = book.PageCount.GetValueOrDefault();
        if (pages > 0)
        {
            estimatedProgressPages = Math.Clamp((int)Math.Round(pages * completion / 100.0), 0, pages);
        }

        int? userBookReadId = null;
        if (completion > 0 || book.IsFinished)
        {
            userBookReadId = await UpsertUserBookReadAsync(
                settings.HardcoverApiToken!,
                userBook.UserBookId,
                book.HardcoverUserBookReadId ?? userBook.UserBookReadId,
                book.HardcoverEditionId,
                estimatedProgressPages,
                completion >= 100 || book.IsFinished,
                cancellationToken);
        }

        book.HardcoverUserBookId = userBook.UserBookId;
        book.HardcoverUserBookReadId = userBookReadId ?? book.HardcoverUserBookReadId ?? userBook.UserBookReadId;
        book.HardcoverLastSyncedAt = DateTime.UtcNow;
        settings.HardcoverLastSyncAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);

        return new HardcoverProgressSyncResult(book.BookId, true, false, completion, statusId, estimatedProgressPages, "Synced progress to Hardcover.");
    }

    public async Task<HardcoverSyncAllResult> SyncAllAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var settings = await RequireSettingsWithTokenAsync(userId, cancellationToken);
        if (!settings.HardcoverSyncEnabled)
        {
            return new HardcoverSyncAllResult(Array.Empty<HardcoverProgressSyncResult>(), "Hardcover sync is disabled.");
        }

        var bookIds = await _context.Books
            .Where(book => book.UserId == userId)
            .OrderBy(book => book.Title)
            .Select(book => book.BookId)
            .ToListAsync(cancellationToken);

        var results = new List<HardcoverProgressSyncResult>();
        foreach (var id in bookIds)
        {
            try
            {
                await ImportMetadataAsync(userId, id, cancellationToken);
                results.Add(await SyncProgressAsync(userId, id, requireSyncEnabled: true, cancellationToken));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Hardcover sync failed for book {BookId}", id);
                results.Add(new HardcoverProgressSyncResult(id, false, false, 0, null, null, ex.Message));
            }
        }

        settings.HardcoverLastSyncAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);
        return new HardcoverSyncAllResult(results, $"Synced {results.Count(result => result.Success)} of {results.Count} books.");
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
            throw new InvalidOperationException("Hardcover API token is not configured.");
        }

        return settings;
    }

    private async Task<Book> GetOwnedBookAsync(Guid userId, int bookId, bool includeTexts, CancellationToken cancellationToken)
    {
        IQueryable<Book> query = _context.Books.Where(book => book.BookId == bookId && book.UserId == userId);
        if (includeTexts)
        {
            query = query.Include(book => book.Texts);
        }

        return await query.FirstOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Book not found.");
    }

    private async Task<HardcoverUser> GetMeAsync(string token, CancellationToken cancellationToken)
    {
        const string query = "query { me { id username } }";
        var data = await ExecuteGraphQlAsync(token, query, null, cancellationToken);
        var me = data.GetProperty("me");
        return new HardcoverUser(me.GetProperty("id").GetInt32(), me.GetProperty("username").GetString());
    }

    private async Task<IReadOnlyList<HardcoverBookCandidate>> FindCandidatesAsync(string token, Book book, CancellationToken cancellationToken)
    {
        var ids = await SearchBookIdsAsync(token, book.Title, cancellationToken);
        var candidates = ids.Count > 0
            ? await FindBooksByIdsAsync(token, ids, cancellationToken)
            : Array.Empty<HardcoverBookCandidate>();

        if (candidates.Count > 0)
        {
            return candidates;
        }

        return await FindBooksByExactTitleAsync(token, book.Title, cancellationToken);
    }

    private async Task<IReadOnlyList<int>> SearchBookIdsAsync(string token, string title, CancellationToken cancellationToken)
    {
        const string query = """
            query SearchBooks($query: String!) {
              search(query: $query, query_type: "Book", per_page: 10, page: 1) {
                ids
              }
            }
            """;

        var data = await ExecuteGraphQlAsync(token, query, new { query = title }, cancellationToken);
        if (!data.TryGetProperty("search", out var search) || !search.TryGetProperty("ids", out var ids) || ids.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<int>();
        }

        return ids.EnumerateArray()
            .Where(id => id.ValueKind == JsonValueKind.Number && id.TryGetInt32(out _))
            .Select(id => id.GetInt32())
            .Distinct()
            .Take(10)
            .ToList();
    }

    private async Task<IReadOnlyList<HardcoverBookCandidate>> FindBooksByIdsAsync(string token, IEnumerable<int> ids, CancellationToken cancellationToken)
    {
        var distinctIds = ids.Distinct().Take(10).ToList();
        if (distinctIds.Count == 0)
        {
            return Array.Empty<HardcoverBookCandidate>();
        }

        const string query = """
            query BooksByIds($ids: [Int!]) {
              books(where: { id: { _in: $ids } }, limit: 10) {
                id
                title
                description
                pages
                release_date
                image { url }
                contributions { author { name } }
                editions(limit: 5, order_by: { users_count: desc }) {
                  id
                  title
                  isbn_13
                  pages
                  release_date
                  publisher { name }
                  image { url }
                }
              }
            }
            """;

        var data = await ExecuteGraphQlAsync(token, query, new { ids = distinctIds }, cancellationToken);
        return ParseBookCandidates(data);
    }

    private async Task<IReadOnlyList<HardcoverBookCandidate>> FindBooksByExactTitleAsync(string token, string title, CancellationToken cancellationToken)
    {
        const string query = """
            query BooksByTitle($title: String!) {
              books(where: { title: { _eq: $title } }, limit: 10) {
                id
                title
                description
                pages
                release_date
                image { url }
                contributions { author { name } }
                editions(limit: 5, order_by: { users_count: desc }) {
                  id
                  title
                  isbn_13
                  pages
                  release_date
                  publisher { name }
                  image { url }
                }
              }
            }
            """;

        var data = await ExecuteGraphQlAsync(token, query, new { title }, cancellationToken);
        return ParseBookCandidates(data);
    }

    private static IReadOnlyList<HardcoverBookCandidate> ParseBookCandidates(JsonElement data)
    {
        if (!data.TryGetProperty("books", out var books) || books.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<HardcoverBookCandidate>();
        }

        var candidates = new List<HardcoverBookCandidate>();
        foreach (var book in books.EnumerateArray())
        {
            var bestEdition = book.TryGetProperty("editions", out var editions) && editions.ValueKind == JsonValueKind.Array
                ? editions.EnumerateArray().FirstOrDefault()
                : default;

            var author = book.TryGetProperty("contributions", out var contributions) && contributions.ValueKind == JsonValueKind.Array
                ? contributions.EnumerateArray()
                    .Select(contribution => contribution.TryGetProperty("author", out var authorElement) && authorElement.ValueKind == JsonValueKind.Object
                        ? GetString(authorElement, "name")
                        : null)
                    .FirstOrDefault(name => !string.IsNullOrWhiteSpace(name))
                : null;

            candidates.Add(new HardcoverBookCandidate(
                BookId: GetInt(book, "id") ?? 0,
                EditionId: bestEdition.ValueKind == JsonValueKind.Object ? GetInt(bestEdition, "id") : null,
                Title: GetString(book, "title") ?? string.Empty,
                Description: GetString(book, "description"),
                Author: author,
                Isbn13: bestEdition.ValueKind == JsonValueKind.Object ? GetString(bestEdition, "isbn_13") : null,
                Publisher: bestEdition.ValueKind == JsonValueKind.Object && bestEdition.TryGetProperty("publisher", out var publisher) && publisher.ValueKind == JsonValueKind.Object
                    ? GetString(publisher, "name")
                    : null,
                ReleaseDate: ParseDate(GetString(book, "release_date")) ?? (bestEdition.ValueKind == JsonValueKind.Object ? ParseDate(GetString(bestEdition, "release_date")) : null),
                Pages: GetInt(book, "pages") ?? (bestEdition.ValueKind == JsonValueKind.Object ? GetInt(bestEdition, "pages") : null),
                ImageUrl: GetImageUrl(book) ?? (bestEdition.ValueKind == JsonValueKind.Object ? GetImageUrl(bestEdition) : null),
                Score: 0));
        }

        return candidates;
    }

    private static double ScoreCandidate(Book book, HardcoverBookCandidate candidate)
    {
        var localTitle = NormalizeForMatch(book.Title);
        var remoteTitle = NormalizeForMatch(candidate.Title);
        if (localTitle.Length == 0 || remoteTitle.Length == 0)
        {
            return 0;
        }

        if (localTitle == remoteTitle)
        {
            return 0.97;
        }

        if (remoteTitle.Contains(localTitle, StringComparison.Ordinal) || localTitle.Contains(remoteTitle, StringComparison.Ordinal))
        {
            return 0.84;
        }

        var localWords = localTitle.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        var remoteWords = remoteTitle.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        if (localWords.Count == 0 || remoteWords.Count == 0)
        {
            return 0;
        }

        var intersection = localWords.Intersect(remoteWords).Count();
        var union = localWords.Union(remoteWords).Count();
        return Math.Round((double)intersection / union, 3);
    }

    private static string NormalizeForMatch(string value)
    {
        var normalized = value.ToLowerInvariant();
        normalized = Regex.Replace(normalized, @"[^\p{L}\p{N}]+", " ");
        return Regex.Replace(normalized, @"\s+", " ").Trim();
    }

    private static void ApplyMatch(Book book, HardcoverBookCandidate candidate)
    {
        book.HardcoverBookId = candidate.BookId;
        book.HardcoverEditionId = candidate.EditionId;
        book.HardcoverMatchedAt ??= DateTime.UtcNow;
        if (!book.PageCount.HasValue && candidate.Pages.HasValue)
        {
            book.PageCount = candidate.Pages.Value;
        }
    }

    private static double CalculatePartCompletion(Book book)
    {
        var total = book.Texts.Count;
        if (total == 0)
        {
            return book.IsFinished ? 100 : 0;
        }

        var finished = book.Texts.Count(text => text.IsFinished);
        return Math.Round((double)finished / total * 100, 2);
    }

    private static int ResolveHardcoverStatus(double completion, bool isFinished)
    {
        if (completion >= 100 || isFinished)
        {
            return ReadStatus;
        }

        return completion > 0 ? CurrentlyReadingStatus : WantToReadStatus;
    }

    private async Task<HardcoverUserBook> EnsureUserBookAsync(string token, Book book, int statusId, CancellationToken cancellationToken)
    {
        if (book.HardcoverUserBookId.HasValue)
        {
            var existingUserBook = !book.HardcoverUserBookReadId.HasValue && book.HardcoverBookId.HasValue
                ? await FindUserBookAsync(token, book.HardcoverBookId.Value, cancellationToken)
                : null;
            await UpdateUserBookAsync(token, book.HardcoverUserBookId.Value, statusId, book.HardcoverEditionId, cancellationToken);
            return new HardcoverUserBook(book.HardcoverUserBookId.Value, statusId, existingUserBook?.UserBookReadId);
        }

        var existing = await FindUserBookAsync(token, book.HardcoverBookId!.Value, cancellationToken);
        if (existing != null)
        {
            await UpdateUserBookAsync(token, existing.UserBookId, statusId, book.HardcoverEditionId, cancellationToken);
            return existing with { StatusId = statusId };
        }

        const string mutation = """
            mutation InsertUserBook($object: UserBookCreateInput!) {
              insert_user_book(object: $object) {
                id
                error
                user_book { id status_id }
              }
            }
            """;

        var variables = new
        {
            @object = new Dictionary<string, object?>
            {
                ["book_id"] = book.HardcoverBookId.Value,
                ["edition_id"] = book.HardcoverEditionId,
                ["status_id"] = statusId,
                ["date_added"] = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            }
        };
        var data = await ExecuteGraphQlAsync(token, mutation, variables, cancellationToken);
        var result = data.GetProperty("insert_user_book");
        ThrowIfMutationError(result);
        var userBookId = result.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.Number
            ? id.GetInt32()
            : result.GetProperty("user_book").GetProperty("id").GetInt32();
        return new HardcoverUserBook(userBookId, statusId, null);
    }

    private async Task<HardcoverUserBook?> FindUserBookAsync(string token, int hardcoverBookId, CancellationToken cancellationToken)
    {
        const string query = """
            query UserBook($bookId: Int!) {
              me {
                user_books(where: { book_id: { _eq: $bookId } }, limit: 1) {
                  id
                  status_id
                  user_book_reads(limit: 1, order_by: { id: desc }) { id }
                }
              }
            }
            """;

        var data = await ExecuteGraphQlAsync(token, query, new { bookId = hardcoverBookId }, cancellationToken);
        var userBooks = data.GetProperty("me").GetProperty("user_books");
        var userBook = userBooks.EnumerateArray().FirstOrDefault();
        if (userBook.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        int? userBookReadId = null;
        if (userBook.TryGetProperty("user_book_reads", out var userBookReads) && userBookReads.ValueKind == JsonValueKind.Array)
        {
            var userBookRead = userBookReads.EnumerateArray().FirstOrDefault();
            if (userBookRead.ValueKind == JsonValueKind.Object)
            {
                userBookReadId = GetInt(userBookRead, "id");
            }
        }

        return new HardcoverUserBook(
            userBook.GetProperty("id").GetInt32(),
            userBook.GetProperty("status_id").GetInt32(),
            userBookReadId);
    }

    private async Task UpdateUserBookAsync(string token, int userBookId, int statusId, int? editionId, CancellationToken cancellationToken)
    {
        const string mutation = """
            mutation UpdateUserBook($id: Int!, $object: UserBookUpdateInput!) {
              update_user_book(id: $id, object: $object) {
                id
                error
                user_book { id status_id }
              }
            }
            """;

        var update = new Dictionary<string, object?>
        {
            ["status_id"] = statusId,
            ["last_read_date"] = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
        };
        if (editionId.HasValue)
        {
            update["edition_id"] = editionId.Value;
        }

        var data = await ExecuteGraphQlAsync(token, mutation, new { id = userBookId, @object = update }, cancellationToken);
        ThrowIfMutationError(data.GetProperty("update_user_book"));
    }

    private async Task<int?> UpsertUserBookReadAsync(
        string token,
        int userBookId,
        int? existingReadId,
        int? editionId,
        int? progressPages,
        bool finished,
        CancellationToken cancellationToken)
    {
        var read = new Dictionary<string, object?>
        {
            ["edition_id"] = editionId,
            ["progress_pages"] = progressPages,
            ["started_at"] = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ["finished_at"] = finished ? DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null
        };

        if (existingReadId.HasValue)
        {
            const string updateMutation = """
                mutation UpdateUserBookRead($id: Int!, $object: DatesReadInput!) {
                  update_user_book_read(id: $id, object: $object) {
                    id
                    error
                    user_book_read { id }
                  }
                }
                """;
            var data = await ExecuteGraphQlAsync(token, updateMutation, new { id = existingReadId.Value, @object = read }, cancellationToken);
            var result = data.GetProperty("update_user_book_read");
            ThrowIfMutationError(result);
            return result.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.Number
                ? id.GetInt32()
                : existingReadId.Value;
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
        var insertData = await ExecuteGraphQlAsync(token, insertMutation, new { userBookId, userBookRead = read }, cancellationToken);
        var insertResult = insertData.GetProperty("insert_user_book_read");
        ThrowIfMutationError(insertResult);
        return insertResult.TryGetProperty("id", out var insertedId) && insertedId.ValueKind == JsonValueKind.Number
            ? insertedId.GetInt32()
            : insertResult.GetProperty("user_book_read").GetProperty("id").GetInt32();
    }

    private async Task<JsonElement> ExecuteGraphQlAsync(string token, string query, object? variables, CancellationToken cancellationToken)
    {
        var httpClient = _httpClientFactory.CreateClient();
        httpClient.Timeout = TimeSpan.FromSeconds(30);

        using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", NormalizeToken(token));
        request.Content = new StringContent(JsonSerializer.Serialize(new { query, variables }, JsonOptions), Encoding.UTF8, "application/json");

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Hardcover API error: {(int)response.StatusCode} {response.ReasonPhrase}");
        }

        using var document = JsonDocument.Parse(responseBody);
        if (document.RootElement.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0)
        {
            var message = errors[0].TryGetProperty("message", out var errorMessage)
                ? errorMessage.GetString()
                : "Unknown GraphQL error";
            throw new InvalidOperationException($"Hardcover GraphQL error: {message}");
        }

        return document.RootElement.GetProperty("data").Clone();
    }

    private static string NormalizeToken(string token)
    {
        var trimmed = token.Trim();
        return trimmed.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            ? trimmed["Bearer ".Length..].Trim()
            : trimmed;
    }

    private async Task<string?> DownloadCoverAsync(string imageUrl, Guid userId, int bookId, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri))
        {
            return null;
        }

        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            using var response = await httpClient.GetAsync(uri, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var extension = Path.GetExtension(uri.AbsolutePath);
            if (string.IsNullOrWhiteSpace(extension) || extension.Length > 5)
            {
                extension = ".jpg";
            }

            var relativeDirectory = Path.Combine("hardcover-covers", userId.ToString("N"));
            var absoluteDirectory = Path.Combine(GetWebRootPath(), relativeDirectory);
            Directory.CreateDirectory(absoluteDirectory);

            var fileName = $"{bookId}{extension}";
            var absolutePath = Path.Combine(absoluteDirectory, fileName);
            await using var fileStream = File.Create(absolutePath);
            await response.Content.CopyToAsync(fileStream, cancellationToken);

            return Path.Combine(relativeDirectory, fileName).Replace('\\', '/');
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to download Hardcover cover for book {BookId}", bookId);
            return null;
        }
    }

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

    private static DateTime? ParseDate(string? value)
    {
        return DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date)
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
            throw new InvalidOperationException(error.GetString());
        }
    }
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

public sealed record HardcoverBookCandidate(
    int BookId,
    int? EditionId,
    string Title,
    string? Description,
    string? Author,
    string? Isbn13,
    string? Publisher,
    DateTime? ReleaseDate,
    int? Pages,
    string? ImageUrl,
    double Score);

internal sealed record HardcoverUser(int Id, string? Username);

internal sealed record HardcoverUserBook(int UserBookId, int StatusId, int? UserBookReadId);
