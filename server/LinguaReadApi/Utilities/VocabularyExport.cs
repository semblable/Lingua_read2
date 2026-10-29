using System.Globalization;
using System.Net;
using System.Text;

namespace LinguaReadApi.Utilities;

public sealed class VocabularyExportRow
{
    public int WordId { get; init; }
    public int LanguageId { get; init; }
    public string Term { get; init; } = "";
    public string? Translation { get; init; }
    public int Status { get; init; }
    public string Language { get; init; } = "";
    public int? ContextId { get; init; }
    public string? Context { get; init; }
    public DateTime? ContextCreatedAtUtc { get; init; }
    public int? TextId { get; init; }
    public string? TextTitle { get; init; }
    public int? BookId { get; init; }
    public string? BookTitle { get; init; }
    public string? SourceUrl { get; init; }
}

public static class VocabularyExport
{
    public static string ContextCsv(IReadOnlyList<VocabularyExportRow> rows)
    {
        var result = new StringBuilder("Term,Translation,Status,Language,WordId,LanguageId,ContextId,Context,TextId,TextTitle,BookId,BookTitle,SourceUrl,ContextCreatedAtUtc\r\n");
        foreach (var row in rows)
        {
            result.AppendJoin(',', new[] { row.Term, row.Translation, Number(row.Status), row.Language,
                Number(row.WordId), Number(row.LanguageId), Number(row.ContextId), row.Context,
                Number(row.TextId), row.TextTitle, Number(row.BookId), row.BookTitle, row.SourceUrl,
                row.ContextCreatedAtUtc?.ToString("O", CultureInfo.InvariantCulture) }.Select(CsvCell));
            result.Append("\r\n");
        }
        return result.ToString();
    }

    // Anki uses a stable first field for duplicate matching, not its internal GUID.
    // One note per word keeps every context together when repeated imports update a note.
    public static string Anki(IReadOnlyList<VocabularyExportRow> rows, Guid userId)
    {
        var result = new StringBuilder("#separator:Tab\n#html:true\n#notetype:LinguaRead Context\n#columns:LinguaReadId\tTerm\tTranslation\tLanguage\tStatus\tContexts\n");
        foreach (var group in rows.GroupBy(row => row.WordId))
        {
            var word = group.First();
            var contexts = group.Where(row => row.ContextId.HasValue).Select(row =>
                $"<div>{Html(row.Context)}<br><small>Context {row.ContextId}: {Html(row.TextTitle)} (text {Number(row.TextId)})<br>" +
                $"{Html(row.BookTitle)} (book {Number(row.BookId)})<br>{Html(row.SourceUrl)}</small></div>");
            result.AppendJoin('\t', $"lr:{userId:N}:{word.WordId}", Html(word.Term), Html(word.Translation),
                Html(word.Language), Number(word.Status), string.Join("<hr>", contexts));
            result.Append('\n');
        }
        return result.ToString();
    }

    private static string Number(int? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "";

    private static string Html(string? value) => "<span>" + WebUtility.HtmlEncode(value ?? "")
        .Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", "<br>").Replace("\t", "&#9;") + "</span>";

    private static string CsvCell(string? value)
    {
        value ??= "";
        var trimmed = value.TrimStart();
        // Quoting alone does not neutralize spreadsheet formulas. Prefix risky
        // cells, including formulas hidden behind whitespace, with a literal apostrophe.
        if ((trimmed.Length > 0 && "=+-@＝＋－＠".Contains(trimmed[0])) ||
            (value.Length > 0 && "\t\r\n".Contains(value[0])))
            value = "'" + value;
        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0
            ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;
    }
}
