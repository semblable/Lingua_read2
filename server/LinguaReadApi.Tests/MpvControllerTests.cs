using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using LinguaReadApi.Authorization;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace LinguaReadApi.Tests;

public class MpvControllerTests
{
    private const string Password = "synthetic-mpv-fixture-password";
    private const string SetupToken = "synthetic-mpv-operator-setup-token";
    private const string JwtKey = "synthetic-mpv-jwt-signing-key-at-least-32-bytes";
    private static readonly Guid OwnerId = LocalMode.OwnerId;

    [Fact]
    public async Task MpvToken_EnforcesScopeAllowlist_AndBlocksDangerousRoutes()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        int spanishId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var es = new Language
            {
                Name = "Spanish",
                Code = "es",
                WordCharacters = Language.LatinWordCharacters
            };
            db.Languages.Add(es);
            await db.SaveChangesAsync();
            spanishId = es.LanguageId;
        }

        var browserCookie = await SetupAndGetCookieAsync(client);
        var mintRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/auth/mpv-token", null, browserCookie);
        Assert.Equal(HttpStatusCode.OK, mintRes.StatusCode);
        var mintJson = await mintRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(mintJson.GetProperty("localMode").GetBoolean());
        var mpvToken = mintJson.GetProperty("token").GetString()!;
        Assert.False(string.IsNullOrWhiteSpace(mpvToken));

        // Allowed mpv endpoints
        var langsRes = await SendWithBearerAsync(client, HttpMethod.Get, "/api/mpv/languages", null, mpvToken);
        Assert.Equal(HttpStatusCode.OK, langsRes.StatusCode);
        var langsJson = await langsRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("EN", langsJson.GetProperty("translationTargetLanguageCode").GetString());
        Assert.False(langsJson.GetProperty("pauseOnWordClick").GetBoolean());
        Assert.True(langsJson.GetProperty("autoTranslateWords").GetBoolean());
        Assert.False(langsJson.GetProperty("autoTranslateOnOpen").GetBoolean());
        Assert.Equal(5, langsJson.GetProperty("autoTranslateWordStatus").GetInt32());
        Assert.Equal("deepl", langsJson.GetProperty("wordTranslationProvider").GetString());
        Assert.Equal(0, langsJson.GetProperty("defaultLanguageId").GetInt32());
        Assert.Single(langsJson.GetProperty("languages").EnumerateArray());

        var sessionRes = await SendWithBearerAsync(client, HttpMethod.Post, "/api/mpv/session", new
        {
            languageId = spanishId,
            title = "Episodio 1",
            cues = new[]
            {
                new { startSeconds = 1.0, endSeconds = 3.5, text = "Hola mundo bonito." }
            }
        }, mpvToken);
        Assert.Equal(HttpStatusCode.OK, sessionRes.StatusCode);
        var sessionJson = await sessionRes.Content.ReadFromJsonAsync<JsonElement>();
        var textId = sessionJson.GetProperty("textId").GetInt32();
        var studyRevision = sessionJson.GetProperty("studyRevision").GetString()!;

        Assert.Equal(HttpStatusCode.OK,
            (await SendWithBearerAsync(client, HttpMethod.Get, "/api/languages", null, mpvToken)).StatusCode);

        var createWordRes = await SendWithBearerAsync(client, HttpMethod.Post, "/api/words", new
        {
            textId,
            term = "mundo",
            status = 2,
            translation = "world",
            sentence = "Hola mundo bonito.",
            replaceExisting = true
        }, mpvToken);
        Assert.True(createWordRes.StatusCode is HttpStatusCode.OK or HttpStatusCode.Created);
        var createdWord = await createWordRes.Content.ReadFromJsonAsync<JsonElement>();
        var wordId = createdWord.GetProperty("wordId").GetInt32();

        Assert.Equal(HttpStatusCode.NoContent,
            (await SendWithBearerAsync(client, HttpMethod.Put, $"/api/words/{wordId}", new
            {
                status = 3,
                translation = "world"
            }, mpvToken)).StatusCode);

        Assert.Equal(HttpStatusCode.OK,
            (await SendWithBearerAsync(client, HttpMethod.Post, "/api/activity/logListening", new
            {
                languageId = spanishId,
                durationSeconds = 12,
                clientEventId = "mpv-scope-test-1",
                lesson = new
                {
                    textId,
                    sourceRevision = studyRevision,
                    playedSeconds = 12.0,
                    audioDurationSeconds = 3.5
                }
            }, mpvToken)).StatusCode);

        Assert.Equal(HttpStatusCode.OK,
            (await SendWithBearerAsync(client, HttpMethod.Put, "/api/activity/audiolessonprogress", new
            {
                textId,
                currentPosition = 2.5,
                clientUpdatedAt = DateTime.UtcNow
            }, mpvToken)).StatusCode);

        Assert.Equal(HttpStatusCode.OK,
            (await SendWithBearerAsync(client, HttpMethod.Get, $"/api/activity/audiolessonprogress/{textId}", null, mpvToken)).StatusCode);

        // Blocked dangerous / non-allowlisted endpoints must return 403 JSON
        var blockedRequests = new (HttpMethod Method, string Path, object? Body)[]
        {
            (HttpMethod.Get, "/api/datamanagement/backup", null),
            (HttpMethod.Get, "/api/usersettings", null),
            (HttpMethod.Put, "/api/usersettings", new { theme = "dark" }),
            (HttpMethod.Post, "/api/auth/change-password", new { currentPassword = Password, newPassword = "new-password-12345" }),
            (HttpMethod.Post, "/api/auth/mpv-token", null),
            (HttpMethod.Post, "/api/auth/mpv-token/revoke", null),
            (HttpMethod.Delete, $"/api/words/{wordId}", null),
            (HttpMethod.Get, $"/api/words/{wordId}", null),
            (HttpMethod.Put, "/api/words/0", new { status = 3 }),
            (HttpMethod.Put, $"/api/words/{wordId}/extra", new { status = 3 }),
            (HttpMethod.Post, "/api/words/batch", new { languageId = spanishId, terms = new[] { new { term = "hola", status = 5 } } }),
            (HttpMethod.Get, "/api/words/export", null),
            (HttpMethod.Get, "/api/activity/audiolessonprogress/0", null),
            (HttpMethod.Post, $"/api/languages/{spanishId}/reset-content", null),
            (HttpMethod.Post, "/api/translation/batch", new { words = new[] { "hola" }, targetLanguageCode = "EN", sourceLanguageCode = "es" }),
            (HttpMethod.Get, "/api/translation/define?term=hola", null),
            (HttpMethod.Post, "/api/sentencetranslation/full-text", new { text = "Hola", sourceLanguageCode = "es", targetLanguageCode = "EN" }),
            (HttpMethod.Get, $"/audio_lessons/{OwnerId}/clip.mp3", null),
            (HttpMethod.Get, "/api/mpv/..%2fusersettings", null),
            (HttpMethod.Get, "/api/mpv/%2e%2e/usersettings", null),
            (HttpMethod.Get, "/api/languages//", null),
        };

        foreach (var (method, path, body) in blockedRequests)
        {
            var blockedRes = await SendWithBearerAsync(client, method, path, body, mpvToken);
            Assert.Equal(HttpStatusCode.Forbidden, blockedRes.StatusCode);
            var errJson = await blockedRes.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Contains("scoped mpv token", errJson.GetProperty("message").GetString(), StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task MpvToken_MintAndRevoke_HandlesJwtAndLocalModeSafely()
    {
        // --- JWT Mode ---
        using (var jwtFactory = CreateFactory(localMode: false))
        using (var client = jwtFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false }))
        {
            var oldCookie = await SetupAndGetCookieAsync(client);
            var mintRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/auth/mpv-token", null, oldCookie);
            Assert.Equal(HttpStatusCode.OK, mintRes.StatusCode);
            var mpvToken = (await mintRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;

            // Explicit Bearer takes precedence over .LinguaRead.Auth cookie (so scoped token gets 403 on /api/usersettings)
            var bothReq = new HttpRequestMessage(HttpMethod.Get, "/api/usersettings");
            bothReq.Headers.Add("Cookie", oldCookie);
            bothReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", mpvToken);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(bothReq)).StatusCode);

            // Non-Bearer Authorization header (e.g. Basic) still allows cookie fallback
            var basicPlusCookieReq = new HttpRequestMessage(HttpMethod.Get, "/api/usersettings");
            basicPlusCookieReq.Headers.Add("Cookie", oldCookie);
            basicPlusCookieReq.Headers.Authorization = new AuthenticationHeaderValue("Basic", "dGVzdDp0ZXN0");
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(basicPlusCookieReq)).StatusCode);

            string stampBeforeRevoke;
            using (var scope = jwtFactory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                stampBeforeRevoke = (await db.Users.FindAsync(OwnerId))!.SecurityStamp!;
            }

            var revokeRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/auth/mpv-token/revoke", null, oldCookie);
            Assert.Equal(HttpStatusCode.OK, revokeRes.StatusCode);
            var freshCookie = ExtractCookie(revokeRes);

            using (var scope = jwtFactory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var stampAfterRevoke = (await db.Users.FindAsync(OwnerId))!.SecurityStamp!;
                Assert.NotEqual(stampBeforeRevoke, stampAfterRevoke);
            }

            // Current browser stays signed in with fresh cookie, while old cookie & old mpv token fail with 401
            Assert.Equal(HttpStatusCode.OK,
                (await SendWithCookieAsync(client, HttpMethod.Get, "/api/usersettings", null, freshCookie)).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await SendWithCookieAsync(client, HttpMethod.Get, "/api/usersettings", null, oldCookie)).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await SendWithBearerAsync(client, HttpMethod.Get, "/api/mpv/languages", null, mpvToken)).StatusCode);
        }

        // --- LocalMode ---
        using (var localFactory = CreateFactory(localMode: true))
        using (var localClient = localFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false }))
        {
            string initialStamp;
            using (var scope = localFactory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var owner = (await db.Users.FindAsync(OwnerId))!;
                owner.SecurityStamp = "preserved-local-mpv-stamp";
                await db.SaveChangesAsync();
                initialStamp = owner.SecurityStamp;
            }

            var localMintReq = new HttpRequestMessage(HttpMethod.Post, "/api/auth/mpv-token");
            localMintReq.Headers.Add("X-Requested-With", "XMLHttpRequest");
            var localMintRes = await localClient.SendAsync(localMintReq);
            Assert.Equal(HttpStatusCode.OK, localMintRes.StatusCode);
            var localMintJson = await localMintRes.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(localMintJson.GetProperty("localMode").GetBoolean());
            Assert.Equal(string.Empty, localMintJson.GetProperty("token").GetString());
            Assert.Equal(JsonValueKind.Null, localMintJson.GetProperty("expiresAt").ValueKind);

            var localRevokeReq = new HttpRequestMessage(HttpMethod.Post, "/api/auth/mpv-token/revoke");
            localRevokeReq.Headers.Add("X-Requested-With", "XMLHttpRequest");
            var localRevokeRes = await localClient.SendAsync(localRevokeReq);
            Assert.Equal(HttpStatusCode.Conflict, localRevokeRes.StatusCode);

            using (var scope = localFactory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var owner = (await db.Users.FindAsync(OwnerId))!;
                Assert.Equal(initialStamp, owner.SecurityStamp);
            }
        }
    }

    [Fact]
    public async Task CreateSession_EnforcesEuropeanScriptGuard()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        int spanishId;
        int serbianId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var es = new Language { Name = "Spanish", Code = "es", WordCharacters = Language.LatinWordCharacters };
            var sr = new Language { Name = "Serbian", Code = "sr", WordCharacters = Language.DefaultWordCharacters };
            db.Languages.AddRange(es, sr);
            await db.SaveChangesAsync();
            spanishId = es.LanguageId;
            serbianId = sr.LanguageId;
        }

        var cookie = await SetupAndGetCookieAsync(client);

        // Cyrillic cues under Spanish must be rejected BEFORE touching the DB
        var badRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/session", new
        {
            languageId = spanishId,
            title = "Wrong Track",
            cues = new[]
            {
                new { startSeconds = 0.5, endSeconds = 2.5, text = "Привет, как твои дела сегодня?" }
            }
        }, cookie);
        Assert.Equal(HttpStatusCode.BadRequest, badRes.StatusCode);
        var badJson = await badRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("Spanish", badJson.GetProperty("message").GetString(), StringComparison.Ordinal);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Empty(db.Folders.Where(f => f.UserId == OwnerId && f.Name == "mpv"));
            Assert.Empty(db.Texts.Where(t => t.UserId == OwnerId));
        }

        // Serbian accepts both Cyrillic and Latin
        var srCyrRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/session", new
        {
            languageId = serbianId,
            title = "Serbian Cyrillic",
            cues = new[]
            {
                new { startSeconds = 0.5, endSeconds = 2.5, text = "Здраво, како си данас пријатељу?" }
            }
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, srCyrRes.StatusCode);

        var srLatRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/session", new
        {
            languageId = serbianId,
            title = "Serbian Latin",
            cues = new[]
            {
                new { startSeconds = 0.5, endSeconds = 2.5, text = "Zdravo, kako si danas prijatelju?" }
            }
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, srLatRes.StatusCode);
    }

    [Fact]
    public async Task CreateSession_UpsertsMpvFolder_RelinksChangedCues_ComputesStats_AndMatchesEuropeanTokensAndPhrases()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        int frenchId;
        int greekId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Folders.Add(new Folder { UserId = OwnerId, Name = "ExistingRoot", SortOrder = 3 });
            var fr = new Language { Name = "French", Code = "fr", WordCharacters = Language.LatinWordCharacters };
            var el = new Language { Name = "Greek", Code = "el", WordCharacters = Language.DefaultWordCharacters };
            db.Languages.AddRange(fr, el);
            await db.SaveChangesAsync();
            frenchId = fr.LanguageId;
            greekId = el.LanguageId;

            var eau = new Word { UserId = OwnerId, LanguageId = frenchId, Term = "eau", Status = 4 };
            var ilYa = new Word { UserId = OwnerId, LanguageId = frenchId, Term = "il y a", Status = 3 };
            var logos = new Word { UserId = OwnerId, LanguageId = greekId, Term = "λόγος", Status = 5 };
            var logosKalos = new Word { UserId = OwnerId, LanguageId = greekId, Term = "λόγος καλός", Status = 4 };
            db.Words.AddRange(eau, ilYa, logos, logosKalos);
            db.WordTranslations.AddRange(
                new WordTranslation { Word = eau, Translation = "water" },
                new WordTranslation { Word = ilYa, Translation = "there is" },
                new WordTranslation { Word = logos, Translation = "word" },
                new WordTranslation { Word = logosKalos, Translation = "good word" }
            );
            await db.SaveChangesAsync();
        }

        var cookie = await SetupAndGetCookieAsync(client);

        // 1. Create initial French episode
        var firstRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/session", new
        {
            languageId = frenchId,
            title = "Episode 01",
            cues = new[]
            {
                new { startSeconds = 1.0, endSeconds = 3.0, text = "Boire l'eau en 2026." },
                new { startSeconds = 4.0, endSeconds = 7.0, text = "Il y a un chat. Il, y a." },
                new { startSeconds = 8.0, endSeconds = 10.0, text = "Ancien mot." }
            }
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, firstRes.StatusCode);
        var firstJson = await firstRes.Content.ReadFromJsonAsync<JsonElement>();
        var textId = firstJson.GetProperty("textId").GetInt32();
        var folderId = firstJson.GetProperty("folderId").GetInt32();
        var cues = firstJson.GetProperty("cues").EnumerateArray().ToList();
        Assert.Equal(3, cues.Count);

        // Cue 1 checks: French elision l'eau -> saved "eau" (status 4), pure numeric 2026 -> status 6
        var cue1Tokens = cues[0].GetProperty("tokens").EnumerateArray().ToList();
        var leauToken = cue1Tokens.Single(t => t.GetProperty("text").GetString() == "l'eau");
        Assert.Equal("eau", leauToken.GetProperty("term").GetString());
        Assert.Equal(4, leauToken.GetProperty("status").GetInt32());
        Assert.Equal("water", leauToken.GetProperty("translation").GetString());

        var numToken = cue1Tokens.Single(t => t.GetProperty("text").GetString() == "2026");
        Assert.Equal(6, numToken.GetProperty("status").GetInt32());

        // Cue 2 checks: "Il y a" matches phrase, "Il, y a" does NOT cross punctuation
        var cue2Tokens = cues[1].GetProperty("tokens").EnumerateArray().ToList();
        var phraseToken = cue2Tokens.FirstOrDefault(t => t.GetProperty("term").GetString() == "il y a");
        Assert.Equal(JsonValueKind.Object, phraseToken.ValueKind);
        Assert.Equal("Il y a", phraseToken.GetProperty("text").GetString());
        Assert.Equal(3, phraseToken.GetProperty("status").GetInt32());
        Assert.Equal("there is", phraseToken.GetProperty("translation").GetString());
        Assert.Equal(1, cue2Tokens.Count(t => t.GetProperty("term").GetString() == "il y a"));

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var mpvFolder = await db.Folders.SingleAsync(f => f.FolderId == folderId);
            Assert.Equal("mpv", mpvFolder.Name);
            Assert.Equal(4, mpvFolder.SortOrder);

            var text = await db.Texts.SingleAsync(t => t.TextId == textId);
            Assert.True(text.IsAudioLesson);
            Assert.Null(text.AudioFilePath);
            Assert.Equal("mpv", text.Tag);
            Assert.Equal("completed", text.WordLinkingStatus);
            Assert.True(text.TotalWords > 0);
            Assert.True(text.KnownWords > 0);
            Assert.NotNull(text.StatsUpdatedAt);
            Assert.Contains("00:00:01,000 --> 00:00:03,000", text.SrtContent);
        }

        // 2. Deduplication on identical cues & title
        var dupRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/session", new
        {
            languageId = frenchId,
            title = "Episode 01",
            cues = new[]
            {
                new { startSeconds = 1.0, endSeconds = 3.0, text = "Boire l'eau en 2026." },
                new { startSeconds = 4.0, endSeconds = 7.0, text = "Il y a un chat. Il, y a." },
                new { startSeconds = 8.0, endSeconds = 10.0, text = "Ancien mot." }
            }
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, dupRes.StatusCode);
        Assert.Equal(textId, (await dupRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("textId").GetInt32());

        // 3. Changing cues invokes RelinkAsync and removes stale TextWord rows ("ancien", "mot")
        var relinkRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/session", new
        {
            languageId = frenchId,
            title = "Episode 01",
            cues = new[]
            {
                new { startSeconds = 1.0, endSeconds = 3.0, text = "Boire l'eau." }
            }
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, relinkRes.StatusCode);
        Assert.Equal(textId, (await relinkRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("textId").GetInt32());

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var linkedTerms = await db.TextWords
                .Where(tw => tw.TextId == textId)
                .Select(tw => tw.Word.Term)
                .ToListAsync();
            Assert.DoesNotContain("ancien", linkedTerms);
            Assert.DoesNotContain("mot", linkedTerms);
            Assert.Contains("eau", linkedTerms);

            var updatedText = await db.Texts.SingleAsync(t => t.TextId == textId);
            Assert.Equal("completed", updatedText.WordLinkingStatus);
            Assert.Equal(2, updatedText.TotalWords); // "boire" (1) + "eau" (1)
            Assert.Equal(1, updatedText.KnownWords); // "eau" (status 4)
        }

        // 4. Greek folded lookup: uppercase unaccented ΛΟΓΟΣ and phrase ΛΟΓΟΣ ΚΑΛΟΣ match saved λόγος / λόγος καλός
        var greekRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/session", new
        {
            languageId = greekId,
            title = "Greek Ep",
            cues = new[]
            {
                new { startSeconds = 0.0, endSeconds = 2.0, text = "Αυτός είναι ΛΟΓΟΣ." },
                new { startSeconds = 2.5, endSeconds = 5.5, text = "ΛΟΓΟΣ ΚΑΛΟΣ σήμερα." }
            }
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, greekRes.StatusCode);
        var greekCues = (await greekRes.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("cues").EnumerateArray().ToList();
        var greekTokens = greekCues[0].GetProperty("tokens").EnumerateArray().ToList();
        var logosTok = greekTokens.Single(t => t.GetProperty("text").GetString() == "ΛΟΓΟΣ");
        Assert.Equal("λόγος", logosTok.GetProperty("term").GetString());
        Assert.Equal(5, logosTok.GetProperty("status").GetInt32());
        Assert.Equal("word", logosTok.GetProperty("translation").GetString());

        var greekPhraseTokens = greekCues[1].GetProperty("tokens").EnumerateArray().ToList();
        var phraseTok = greekPhraseTokens.Single(t => t.GetProperty("term").GetString() == "λόγος καλός");
        Assert.Equal("ΛΟΓΟΣ ΚΑΛΟΣ", phraseTok.GetProperty("text").GetString());
        Assert.Equal(4, phraseTok.GetProperty("status").GetInt32());
        Assert.Equal("good word", phraseTok.GetProperty("translation").GetString());

        // 5. Surrogate-safe >200-char title truncation + GET /api/texts/recent derives AudioDurationSeconds from SRT
        var longTitleWithBoundarySurrogate = new string('a', 199) + "😀extra";
        var longTitleRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/session", new
        {
            languageId = frenchId,
            title = longTitleWithBoundarySurrogate,
            cues = new[]
            {
                new { startSeconds = 0.0, endSeconds = 12.5, text = "Bonjour." }
            }
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, longTitleRes.StatusCode);
        var savedLongTitle = (await longTitleRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString()!;
        Assert.Equal(199, savedLongTitle.Length);
        Assert.False(char.IsHighSurrogate(savedLongTitle[^1]));

        var recentRes = await SendWithCookieAsync(client, HttpMethod.Get, "/api/texts/recent", null, cookie);
        Assert.Equal(HttpStatusCode.OK, recentRes.StatusCode);
        var recentItems = (await recentRes.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToList();
        var recentMpv = recentItems.First(x => x.GetProperty("title").GetString() == savedLongTitle);
        Assert.Equal(12.5, recentMpv.GetProperty("audioDurationSeconds").GetDouble(), 2);
    }

    [Fact]
    public async Task AutoTranslate_MirrorsReaderSettings_PreservesTrackedStatus_AndHandlesRateLimits()
    {
        var fakeWordService = new FakeWordTranslationService();
        using var factory = CreateFactory(wordService: fakeWordService);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        int frenchId;
        int textId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var fr = new Language { Name = "French", Code = "fr", WordCharacters = Language.LatinWordCharacters };
            db.Languages.Add(fr);
            await db.SaveChangesAsync();
            frenchId = fr.LanguageId;

            db.UserSettings.Add(new UserSettings
            {
                UserId = OwnerId,
                AutoTranslateOnOpen = false,
                AutoTranslateWordStatus = 4,
                TranslationTargetLanguageCode = "EN",
                WordTranslationProvider = "deepl"
            });

            var text = new Text
            {
                UserId = OwnerId,
                LanguageId = frenchId,
                Title = "AutoTranslate Ep",
                Content = "Un bien-être quotidien avec 2026 chat maison.",
                IsAudioLesson = true,
                Tag = "mpv"
            };
            db.Texts.Add(text);
            await db.SaveChangesAsync();
            textId = text.TextId;

            var chat = new Word { UserId = OwnerId, LanguageId = frenchId, Term = "chat", Status = 1 };
            var maison = new Word { UserId = OwnerId, LanguageId = frenchId, Term = "maison", Status = 5 };
            var quotidien = new Word { UserId = OwnerId, LanguageId = frenchId, Term = "quotidien", Status = 0 };
            db.Words.AddRange(chat, maison, quotidien);
            db.WordTranslations.Add(new WordTranslation { Word = maison, Translation = "house" });
            db.TextWords.AddRange(
                new TextWord { TextId = textId, Word = chat, OccurrenceCount = 1 },
                new TextWord { TextId = textId, Word = maison, OccurrenceCount = 1 },
                new TextWord { TextId = textId, Word = quotidien, OccurrenceCount = 1 }
            );
            await db.SaveChangesAsync();
        }

        var cookie = await SetupAndGetCookieAsync(client);

        // 1. AutoTranslateOnOpen = false and Force = false -> skipped
        var skipRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/auto-translate", new
        {
            textId,
            force = false
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, skipRes.StatusCode);
        var skipJson = await skipRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(skipJson.GetProperty("skipped").GetBoolean());
        Assert.Empty(fakeWordService.BatchCalls);

        // 2. Force = true -> translates unknown + hyphenated sub-words + status<=2 without translation, keeps status 1
        fakeWordService.BatchHandler = (words, target, source) => new Dictionary<string, string>
        {
            ["un"] = "a",
            ["bien-être"] = "well-being",
            ["bien"] = "well",
            ["être"] = "being",
            ["quotidien"] = "daily",
            ["avec"] = "with",
            ["chat"] = "cat"
        };

        var forceRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/auto-translate", new
        {
            textId,
            force = true
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, forceRes.StatusCode);
        var forceJson = await forceRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(forceJson.GetProperty("skipped").GetBoolean());
        Assert.Equal(7, forceJson.GetProperty("translatedCount").GetInt32());

        Assert.Single(fakeWordService.BatchCalls);
        var (sentWords, sentTarget, sentSource) = fakeWordService.BatchCalls[0];
        Assert.Equal("EN", sentTarget);
        Assert.Equal("fr", sentSource);
        Assert.Contains("bien-être", sentWords);
        Assert.Contains("bien", sentWords);
        Assert.Contains("être", sentWords);
        Assert.Contains("chat", sentWords);
        Assert.Contains("quotidien", sentWords);
        Assert.DoesNotContain("maison", sentWords);
        Assert.DoesNotContain("2026", sentWords);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var chat = await db.Words.Include(w => w.Translation).SingleAsync(w => w.UserId == OwnerId && w.Term == "chat");
            Assert.Equal(1, chat.Status); // Preserved tracked status!
            Assert.Equal("cat", chat.Translation.Translation);

            var quotidien = await db.Words.Include(w => w.Translation).SingleAsync(w => w.UserId == OwnerId && w.Term == "quotidien");
            Assert.Equal(4, quotidien.Status); // AutoTranslateWordStatus = 4 applied to status 0
            Assert.Equal("daily", quotidien.Translation.Translation);

            var bienEtre = await db.Words.Include(w => w.Translation).SingleAsync(w => w.UserId == OwnerId && w.Term == "bien-être");
            Assert.Equal(4, bienEtre.Status);
            Assert.Equal("well-being", bienEtre.Translation.Translation);

            var updatedText = await db.Texts.SingleAsync(t => t.TextId == textId);
            Assert.Equal(8, updatedText.TotalWords);
            Assert.Equal(7, updatedText.KnownWords); // 6 newly raised to 4 + existing "maison" (5)
        }

        // 3. WiktionaryRateLimitException -> 429 TooManyRequests
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var extraText = new Text
            {
                UserId = OwnerId,
                LanguageId = frenchId,
                Title = "RateLimit Ep",
                Content = "bonjour",
                IsAudioLesson = true,
                Tag = "mpv"
            };
            db.Texts.Add(extraText);
            await db.SaveChangesAsync();
            textId = extraText.TextId;
        }
        fakeWordService.BatchHandler = (_, _, _) => throw new WiktionaryRateLimitException();
        var rateRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/auto-translate", new
        {
            textId,
            force = true
        }, cookie);
        Assert.Equal(HttpStatusCode.TooManyRequests, rateRes.StatusCode);
    }

    [Fact]
    public async Task Lookup_UsesWordProviderByDefault_AndFallsBackWhenAiErrorsOrUnconfigured()
    {
        var fakeWordService = new FakeWordTranslationService
        {
            TextHandler = (text, source, target) => $"{text}:{source}->{target}:word"
        };
        var fakeAiService = new FakeSentenceTranslationService();
        using var factory = CreateFactory(wordService: fakeWordService, sentenceService: fakeAiService);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        int frenchId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var fr = new Language { Name = "French", Code = "fr", WordCharacters = Language.LatinWordCharacters };
            db.Languages.Add(fr);
            db.UserSettings.Add(new UserSettings
            {
                UserId = OwnerId,
                TranslationTargetLanguageCode = "EN",
                WordTranslationProvider = "deepl"
            });
            await db.SaveChangesAsync();
            frenchId = fr.LanguageId;
        }

        var cookie = await SetupAndGetCookieAsync(client);

        // 1. Default mode = "word" uses word provider and never calls AI
        var wordRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/lookup", new
        {
            languageId = frenchId,
            term = "voler",
            sentenceContext = "L'oiseau va voler.",
            mode = "word",
            includeSentenceTranslation = false
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, wordRes.StatusCode);
        var wordJson = await wordRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("voler:fr->EN:word", wordJson.GetProperty("translation").GetString());
        Assert.Equal("deepl", wordJson.GetProperty("provider").GetString());
        Assert.Equal(JsonValueKind.Null, wordJson.GetProperty("sentenceTranslation").ValueKind);
        Assert.Equal(0, fakeAiService.CallCount);

        // 2. Context mode uses AI when valid; includeSentenceTranslation strips paired tags
        fakeAiService.SelectionHandler = (sel, ctx, src, tgt) => "to fly (in context)";
        fakeAiService.SentenceHandler = (ctx, src, tgt) => "<o s=\"1\">L'oiseau va voler.</o><t s=\"1\">The bird is going to fly.</t>";

        var ctxRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/lookup", new
        {
            languageId = frenchId,
            term = "voler",
            sentenceContext = "L'oiseau va voler.",
            mode = "context",
            includeSentenceTranslation = true
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, ctxRes.StatusCode);
        var ctxJson = await ctxRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("to fly (in context)", ctxJson.GetProperty("translation").GetString());
        Assert.Equal("ai", ctxJson.GetProperty("provider").GetString());
        Assert.Equal("The bird is going to fly.", ctxJson.GetProperty("sentenceTranslation").GetString());

        // 3. AI returns "Translation error:" / "Translation failed:" -> falls back to word provider cleanly
        fakeAiService.SelectionHandler = (_, _, _, _) => "Translation error: Rate limit exceeded";
        fakeAiService.SentenceHandler = (_, _, _) => "Translation failed: Could not extract result";

        var errFallbackRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/lookup", new
        {
            languageId = frenchId,
            term = "voler",
            sentenceContext = "L'oiseau va voler.",
            mode = "context",
            includeSentenceTranslation = true
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, errFallbackRes.StatusCode);
        var errFallbackJson = await errFallbackRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("voler:fr->EN:word", errFallbackJson.GetProperty("translation").GetString());
        Assert.Equal("deepl", errFallbackJson.GetProperty("provider").GetString());
        Assert.Equal("L'oiseau va voler.:fr->EN:word", errFallbackJson.GetProperty("sentenceTranslation").GetString());

        // 4. AI unconfigured throws TranslationProviderNotConfiguredException -> falls back to word provider
        fakeAiService.ShouldThrowNotConfigured = true;
        var unconfRes = await SendWithCookieAsync(client, HttpMethod.Post, "/api/mpv/lookup", new
        {
            languageId = frenchId,
            term = "maison",
            sentenceContext = "Une grande maison.",
            mode = "context",
            includeSentenceTranslation = true
        }, cookie);
        Assert.Equal(HttpStatusCode.OK, unconfRes.StatusCode);
        var unconfJson = await unconfRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("maison:fr->EN:word", unconfJson.GetProperty("translation").GetString());
        Assert.Equal("deepl", unconfJson.GetProperty("provider").GetString());
        Assert.Equal("Une grande maison.:fr->EN:word", unconfJson.GetProperty("sentenceTranslation").GetString());
    }

    private static async Task<string> SetupAndGetCookieAsync(HttpClient client)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/setup")
        {
            Content = JsonContent.Create(new { password = Password, setupToken = SetupToken })
        };
        req.Headers.Add("X-Requested-With", "XMLHttpRequest");
        var res = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return ExtractCookie(res);
    }

    private static string ExtractCookie(HttpResponseMessage response) =>
        response.Headers.GetValues("Set-Cookie").Single().Split(';')[0];

    private static Task<HttpResponseMessage> SendWithCookieAsync(
        HttpClient client, HttpMethod method, string path, object? body, string cookie)
    {
        var req = new HttpRequestMessage(method, path);
        req.Headers.Add("X-Requested-With", "XMLHttpRequest");
        req.Headers.Add("Cookie", cookie);
        if (body != null) req.Content = JsonContent.Create(body);
        return client.SendAsync(req);
    }

    private static Task<HttpResponseMessage> SendWithBearerAsync(
        HttpClient client, HttpMethod method, string path, object? body, string bearerToken)
    {
        var req = new HttpRequestMessage(method, path);
        req.Headers.Add("X-Requested-With", "XMLHttpRequest");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        if (body != null) req.Content = JsonContent.Create(body);
        return client.SendAsync(req);
    }

    private static WebApplicationFactory<Program> CreateFactory(
        bool localMode = false,
        FakeWordTranslationService? wordService = null,
        FakeSentenceTranslationService? sentenceService = null)
    {
        var dbName = Guid.NewGuid().ToString();
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Auth:LocalMode"] = localMode.ToString(),
                ["Auth:SetupToken"] = SetupToken,
                ["Jwt:Key"] = localMode ? "" : JwtKey,
                ["Jwt:Issuer"] = "fixture",
                ["Jwt:Audience"] = "fixture",
                ["PGDATABASE"] = "unused",
                ["PGUSER"] = "unused",
                ["PGPASSWORD"] = "unused",
                ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=unused"
            }));
            builder.ConfigureServices(services =>
            {
                foreach (var descriptor in services.Where(d =>
                    d.ServiceType == typeof(DbContextOptions<AppDbContext>) ||
                    d.ServiceType == typeof(DbContextOptions) ||
                    (d.ServiceType.IsGenericType &&
                     d.ServiceType.GetGenericTypeDefinition().Name.StartsWith("IDbContextOptionsConfiguration", StringComparison.Ordinal))).ToList())
                {
                    services.Remove(descriptor);
                }

                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(dbName));

                if (localMode)
                {
                    services.AddSingleton<IStartupFilter>(new PeerFilter("127.0.0.1"));
                }

                if (wordService != null)
                {
                    services.RemoveAll<IWordTranslationServiceFactory>();
                    services.AddScoped<IWordTranslationServiceFactory>(_ => new FakeWordFactory(wordService));
                }

                if (sentenceService != null)
                {
                    services.RemoveAll<ITranslationServiceFactory>();
                    services.AddScoped<ITranslationServiceFactory>(_ => new FakeSentenceFactory(sentenceService));
                }
            });
        });

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var owner = new User { Id = OwnerId, UserName = "fixture", Email = "mpv@example.test" };
        if (localMode)
        {
            owner.PasswordHash = new PasswordHasher<User>().HashPassword(owner, Password);
        }
        db.Users.Add(owner);
        db.SaveChanges();
        return factory;
    }

    private sealed class PeerFilter(string peer) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((context, continuation) =>
            {
                context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
                return continuation(context);
            });
            next(app);
        };
    }

    private sealed class FakeWordFactory(FakeWordTranslationService service) : IWordTranslationServiceFactory
    {
        public Task<ITranslationService> GetServiceForUserAsync(Guid userId) => Task.FromResult<ITranslationService>(service);
        public Task<WiktionaryTranslationService> GetWiktionaryServiceForUserAsync(Guid userId) =>
            throw new NotSupportedException();
    }

    private sealed class FakeWordTranslationService : ITranslationService
    {
        public List<(List<string> Words, string Target, string? Source)> BatchCalls { get; } = new();
        public Func<string, string?, string, string>? TextHandler { get; set; }
        public Func<List<string>, string, string?, Dictionary<string, string>>? BatchHandler { get; set; }

        public Task<string> TranslateTextAsync(string text, string? sourceLang, string targetLang)
        {
            return Task.FromResult(TextHandler?.Invoke(text, sourceLang, targetLang) ?? string.Empty);
        }

        public Task<Dictionary<string, string>> TranslateBatchAsync(List<string> words, string targetLang, string? sourceLang = null)
        {
            BatchCalls.Add((words.ToList(), targetLang, sourceLang));
            return Task.FromResult(BatchHandler?.Invoke(words, targetLang, sourceLang) ?? new Dictionary<string, string>());
        }
    }

    private sealed class FakeSentenceFactory(FakeSentenceTranslationService service) : ITranslationServiceFactory
    {
        public Task<ISentenceTranslationService> GetServiceForUserAsync(Guid userId)
        {
            service.CallCount++;
            if (service.ShouldThrowNotConfigured)
            {
                throw new TranslationProviderNotConfiguredException("AI", "AI provider is not configured.");
            }
            return Task.FromResult<ISentenceTranslationService>(service);
        }
    }

    private sealed class FakeSentenceTranslationService : ISentenceTranslationService
    {
        public int CallCount { get; set; }
        public bool ShouldThrowNotConfigured { get; set; }
        public Func<string, string, string, string>? SentenceHandler { get; set; }
        public Func<string, string, string, string, string>? SelectionHandler { get; set; }

        public Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage) =>
            Task.FromResult(SentenceHandler?.Invoke(text, sourceLanguage, targetLanguage) ?? string.Empty);

        public Task<string> TranslateFullTextAsync(string text, string sourceLanguage, string targetLanguage) =>
            Task.FromResult(string.Empty);

        public Task<string> ExplainSentenceAsync(string text, string sourceLanguage, string targetLanguage) =>
            Task.FromResult(string.Empty);

        public Task<string> TranslateSelectionWithContextAsync(string selectedText, string sentenceContext, string sourceLanguage, string targetLanguage) =>
            Task.FromResult(SelectionHandler?.Invoke(selectedText, sentenceContext, sourceLanguage, targetLanguage) ?? string.Empty);
    }
}
