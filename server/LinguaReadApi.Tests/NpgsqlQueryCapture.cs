using System.Data;
using System.Data.Common;
using System.Text.RegularExpressions;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Moq.Protected;
using Npgsql;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Runs production queries through Npgsql's translator without a PostgreSQL server.
/// Only prerequisite Text/Language reads are supplied from fixtures; the first Words
/// query stops execution before it can read or write anything in a database.
/// </summary>
internal sealed class NpgsqlQueryCapture(params object[] fixtures) : DbCommandInterceptor
{
    private CapturedQuery? captured;

    public AppDbContext CreateContext() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseNpgsql(new CaptureConnection())
        .AddInterceptors(this)
        .Options);

    public async Task<CapturedQuery> CaptureAsync(Func<Task> action)
    {
        await Assert.ThrowsAsync<QueryCapturedException>(action);
        return Assert.IsType<CapturedQuery>(captured);
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData,
        InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        if (command.CommandText.Contains("FROM \"Words\"", StringComparison.Ordinal))
        {
            captured = new CapturedQuery(command.CommandText, command.Parameters.Cast<DbParameter>()
                .ToDictionary(p => p.ParameterName.TrimStart('@'), p => p.Value));
            throw new QueryCapturedException();
        }

        return ValueTask.FromResult(InterceptionResult<DbDataReader>.SuppressWithResult(
            PrerequisiteReader(command.CommandText)));
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command, CommandEventData eventData,
        InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        // WordLinker takes the user's transaction lock before probing vocabulary.
        Assert.StartsWith("SELECT pg_advisory_xact_lock(", command.CommandText);
        return ValueTask.FromResult(InterceptionResult<int>.SuppressWithResult(0));
    }

    private DbDataReader PrerequisiteReader(string sql)
    {
        var byAlias = Regex.Matches(sql, @"(?:FROM|JOIN) ""(?<table>[^""]+)"" AS (?<alias>\w+)")
            .ToDictionary(m => m.Groups["alias"].Value, m => Assert.Single(fixtures, fixture =>
                m.Groups["table"].Value == (fixture switch
                {
                    Text => "Texts",
                    Language => "Languages",
                    _ => throw new InvalidOperationException("Only Text and Language fixtures are supported.")
                })));
        var projection = sql[..sql.IndexOf("\nFROM ", StringComparison.Ordinal)];
        var columns = Regex.Matches(projection, @"(?<alias>\w+)\.""(?<column>[^""]+)""");
        Assert.NotEmpty(columns);

        // Follow the provider's projection order instead of copying its SELECT list.
        var table = new DataTable();
        var values = new List<object>();
        foreach (System.Text.RegularExpressions.Match column in columns)
        {
            var fixture = byAlias[column.Groups["alias"].Value];
            var property = fixture.GetType().GetProperty(column.Groups["column"].Value)
                ?? throw new InvalidOperationException($"Unsupported prerequisite column: {column.Value}");
            table.Columns.Add($"column{values.Count}", Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType);
            values.Add(property.GetValue(fixture) ?? DBNull.Value);
        }
        table.Rows.Add(values.ToArray());
        return table.CreateDataReader();
    }

    internal sealed record CapturedQuery(string Sql, IReadOnlyDictionary<string, object?> Parameters);
    private sealed class QueryCapturedException : Exception;

    // Use Npgsql's real translator and parameters, with an ADO connection that never
    // accesses a server. Keeping it open also preserves WordLinker's transaction.
    private sealed class CaptureConnection : DbConnection
    {
        [System.Diagnostics.CodeAnalysis.AllowNull]
        public override string ConnectionString { get; set; } = "Host=localhost;Database=translation-check;Username=none;Password=none";
        public override string Database => "translation-check";
        public override string DataSource => "translation-check";
        public override string ServerVersion => "17.0";
        public override ConnectionState State => ConnectionState.Open;
        public override void Open() { }
        public override void Close() { }
        public override void ChangeDatabase(string databaseName) => throw new NotSupportedException();
        protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel) => new CaptureTransaction(this, isolationLevel);

        protected override DbCommand CreateDbCommand()
        {
            var command = new Mock<DbCommand>();
            command.SetupAllProperties();
            command.Protected().Setup<DbParameter>("CreateDbParameter").Returns(() => new NpgsqlParameter());
            command.Protected().SetupGet<DbParameterCollection>("DbParameterCollection")
                .Returns(new NpgsqlCommand().Parameters);
            return command.Object;
        }
    }

    private sealed class CaptureTransaction(DbConnection connection, IsolationLevel isolationLevel) : DbTransaction
    {
        public override IsolationLevel IsolationLevel => isolationLevel;
        protected override DbConnection DbConnection => connection;
        public override void Commit() => throw new InvalidOperationException("SQL capture must stop before committing.");
        public override void Rollback() => throw new InvalidOperationException("SQL capture must stop before rolling back.");
    }
}
