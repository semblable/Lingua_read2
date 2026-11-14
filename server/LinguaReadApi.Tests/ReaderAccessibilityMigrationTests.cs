using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Xunit;

namespace LinguaReadApi.Tests;

[Collection("Postgres study database")]
public class ReaderAccessibilityMigrationTests
{
    private const string Before = "20261112155846_AutomaticLessonListeningCredit";
    private const string Current = "20261113143545_ReaderAccessibilityPreferences";

    [Fact]
    public void PostgreSqlModelAndIdempotentUpgrade_ContainOnlyTheCompatiblePreferenceColumns()
    {
        // SQL generation never opens this deliberately unusable connection and does not
        // start Program, read .env, or use an application's configured connection string.
        using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=1;Database=unused;Username=unused;Password=unused").Options);
        Assert.False(context.Database.HasPendingModelChanges());
        var migrations = context.Database.GetMigrations().ToList();
        Assert.Contains("20260324181629_AddStoryReasoningSettings", migrations); // Historical Migrations/ directory.
        Assert.Contains(Before, migrations); // Active additive Data/Migrations/ directory.
        Assert.Equal(Current, migrations[^1]);

        var model = context.Model.FindEntityType(typeof(UserSettings))!;
        var shortcuts = model.FindProperty(nameof(UserSettings.ReaderCharacterShortcutsEnabled))!;
        var markers = model.FindProperty(nameof(UserSettings.ReaderStatusMarkersEnabled))!;
        Assert.Equal(true, shortcuts.GetDefaultValue());
        Assert.Equal(true, shortcuts.Sentinel); // An explicit false is sent on a first insert.
        Assert.Equal(false, markers.GetDefaultValue());

        var script = context.GetService<IMigrator>().GenerateScript(Before, Current,
            MigrationsSqlGenerationOptions.Idempotent);
        Assert.Contains("ALTER TABLE \"UserSettings\" ADD \"ReaderCharacterShortcutsEnabled\" boolean NOT NULL DEFAULT TRUE;", script);
        Assert.Contains("ALTER TABLE \"UserSettings\" ADD \"ReaderStatusMarkersEnabled\" boolean NOT NULL DEFAULT FALSE;", script);
        Assert.Contains("IF NOT EXISTS", script);
        Assert.Contains("\"__EFMigrationsHistory\"", script);
        Assert.Contains(Current, script);
        Assert.DoesNotContain("UPDATE ", script);
        Assert.DoesNotContain("DELETE ", script);
        Assert.DoesNotContain("DROP ", script);
        Assert.DoesNotContain("\"Words\"", script);
        Assert.DoesNotContain("\"Texts\"", script);
    }

    [PostgresStudyFact]
    public async Task PostgreSqlUpgrade_BackfillsOldRows_AndPreservesExplicitPreferencesAndVocabulary()
    {
        // CI supplies a disposable studycheck database. Every run owns a unique schema;
        // never accept the configured application database for this destructive fixture.
        var connectionString = Environment.GetEnvironmentVariable("LINGUA_STUDY_TEST_POSTGRES")!;
        var settings = new NpgsqlConnectionStringBuilder(connectionString);
        if (settings.Database != "studycheck")
            throw new InvalidOperationException("Synthetic checks require Database=studycheck.");
        var schema = "reader_accessibility_probe_" + Guid.NewGuid().ToString("N");
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await new NpgsqlCommand($"CREATE SCHEMA {schema}", connection).ExecuteNonQueryAsync();
        settings.SearchPath = schema;
        var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(settings.ToString()).Options;
        var userId = Guid.NewGuid();
        try
        {
            await using (var context = new AppDbContext(options))
            {
                var migrator = context.GetService<IMigrator>();
                await migrator.MigrateAsync(Current);
                context.Users.Add(new User { Id = userId, UserName = "synthetic settings learner" });
                context.Languages.Add(new Language { LanguageId = 1, Code = "en", Name = "English" });
                context.Words.Add(new Word { WordId = 73, UserId = userId, LanguageId = 1, Term = "garden", Status = 3 });
                context.UserSettings.Add(new UserSettings { UserId = userId, Theme = "classic-dark" });
                await context.SaveChangesAsync();

                // Produce a genuine historical row without asking the current model to
                // insert columns that did not exist before this additive migration.
                await migrator.MigrateAsync(Before);
                await migrator.MigrateAsync(Current);
                context.ChangeTracker.Clear();
                var upgraded = await context.UserSettings.SingleAsync();
                Assert.True(upgraded.ReaderCharacterShortcutsEnabled);
                Assert.False(upgraded.ReaderStatusMarkersEnabled);
                Assert.Equal("classic-dark", upgraded.Theme);
                upgraded.Theme = "high-contrast-dark";
                upgraded.ReaderCharacterShortcutsEnabled = false;
                upgraded.ReaderStatusMarkersEnabled = true;
                await context.SaveChangesAsync();
                await migrator.MigrateAsync(Current); // Repeating the upgrade is a no-op.
            }

            await using var reloadedContext = new AppDbContext(options);
            var reloaded = await reloadedContext.UserSettings.SingleAsync();
            Assert.Equal(userId, reloaded.UserId);
            Assert.Equal("high-contrast-dark", reloaded.Theme);
            Assert.False(reloaded.ReaderCharacterShortcutsEnabled);
            Assert.True(reloaded.ReaderStatusMarkersEnabled);
            var vocabulary = await reloadedContext.Words.SingleAsync();
            Assert.Equal(73, vocabulary.WordId);
            Assert.Equal("garden", vocabulary.Term);
            Assert.Equal(3, vocabulary.Status);
            Assert.Single(await reloadedContext.Database.GetAppliedMigrationsAsync(), id => id == Current);
        }
        finally
        {
            await new NpgsqlCommand($"DROP SCHEMA {schema} CASCADE", connection).ExecuteNonQueryAsync();
        }
    }
}
