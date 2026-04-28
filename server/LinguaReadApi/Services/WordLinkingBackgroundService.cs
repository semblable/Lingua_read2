using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using LinguaReadApi.Data;
using LinguaReadApi.Models;

namespace LinguaReadApi.Services
{
    public class WordLinkingBackgroundService : BackgroundService
    {
        private const int WordBatchSize = 500;

        private readonly WordLinkingChannel _channel;
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<WordLinkingBackgroundService> _logger;

        public WordLinkingBackgroundService(
            WordLinkingChannel channel,
            IServiceProvider serviceProvider,
            ILogger<WordLinkingBackgroundService> logger)
        {
            _channel = channel;
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("WordLinkingBackgroundService started.");

            await foreach (var request in _channel.Reader.ReadAllAsync(stoppingToken))
            {
                try
                {
                    _logger.LogInformation(
                        "Processing word linking for TextId={TextId}, UserId={UserId}",
                        request.TextId, request.UserId);

                    using var scope = _serviceProvider.CreateScope();
                    var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                    await LinkWordsToText(context, request);

                    // Mark as completed
                    var text = await context.Texts.FindAsync(new object[] { request.TextId }, stoppingToken);
                    if (text != null)
                    {
                        text.WordLinkingStatus = "completed";
                        await context.SaveChangesAsync(stoppingToken);
                    }

                    _logger.LogInformation("Word linking completed for TextId={TextId}", request.TextId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Word linking failed for TextId={TextId}", request.TextId);

                    // Mark as failed
                    try
                    {
                        using var scope = _serviceProvider.CreateScope();
                        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                        var text = await context.Texts.FindAsync(new object[] { request.TextId }, stoppingToken);
                        if (text != null)
                        {
                            text.WordLinkingStatus = "failed";
                            await context.SaveChangesAsync(stoppingToken);
                        }
                    }
                    catch (Exception innerEx)
                    {
                        _logger.LogError(innerEx, "Failed to update WordLinkingStatus to 'failed' for TextId={TextId}", request.TextId);
                    }
                }
            }
        }

        private static async Task LinkWordsToText(AppDbContext context, WordLinkingRequest request)
        {
            var separators = new char[] { ' ', '\t', '\r', '\n', '.', ',', ';', ':', '!', '?', '\"', '\'', '(', ')', '[', ']', '{', '}', '-', '_', '/', '\\', '|', '@', '#', '$', '%', '^', '&', '*', '+', '=', '<', '>', '`', '~' };
            var wordsInText = request.Content.Split(separators, StringSplitOptions.RemoveEmptyEntries)
                                     .Select(w => w.Trim().ToLowerInvariant())
                                     .Where(w => !string.IsNullOrWhiteSpace(w))
                                     .ToList();

            if (!wordsInText.Any()) return;

            var uniqueWords = wordsInText.Distinct().ToList();

            // Fetch existing words in batches
            var existingWordsList = new List<Word>();
            foreach (var batch in uniqueWords.Chunk(WordBatchSize))
            {
                var batchList = batch.ToList();
                var batchResults = await context.Words
                    .AsNoTracking()
                    .Where(w => w.UserId == request.UserId && w.LanguageId == request.LanguageId && batchList.Contains(w.Term.ToLower()))
                    .ToListAsync();
                existingWordsList.AddRange(batchResults);
            }

            var existingWords = existingWordsList
                .GroupBy(w => w.Term.ToLowerInvariant())
                .ToDictionary(g => g.Key, g => g.First());

            // Create missing words in batches
            var newWords = new List<Word>();
            foreach (var wordTerm in uniqueWords)
            {
                if (!existingWords.ContainsKey(wordTerm))
                {
                    var newWord = new Word
                    {
                        UserId = request.UserId,
                        LanguageId = request.LanguageId,
                        Term = wordTerm,
                        Status = 0,
                        CreatedAt = DateTime.UtcNow
                    };
                    newWords.Add(newWord);
                    existingWords[wordTerm] = newWord;
                }
            }

            foreach (var batch in newWords.Chunk(WordBatchSize))
            {
                context.Words.AddRange(batch);
                await context.SaveChangesAsync();
                context.ChangeTracker.Clear();
            }

            // Skip TextWord rows that already exist (e.g. from prior user clicks); the
            // unique (TextId, WordId) index would otherwise reject the whole batch.
            var existingTextWordIds = new HashSet<int>(
                await context.TextWords
                    .AsNoTracking()
                    .Where(tw => tw.TextId == request.TextId)
                    .Select(tw => tw.WordId)
                    .ToListAsync());

            var textWordsToAdd = new List<TextWord>();
            foreach (var wordTerm in uniqueWords)
            {
                if (existingWords.TryGetValue(wordTerm, out var word) &&
                    !existingTextWordIds.Contains(word.WordId))
                {
                    textWordsToAdd.Add(new TextWord
                    {
                        TextId = request.TextId,
                        WordId = word.WordId,
                        CreatedAt = DateTime.UtcNow
                    });
                }
            }

            foreach (var batch in textWordsToAdd.Chunk(WordBatchSize))
            {
                await context.TextWords.AddRangeAsync(batch);
                await context.SaveChangesAsync();
                context.ChangeTracker.Clear();
            }
        }
    }
}
