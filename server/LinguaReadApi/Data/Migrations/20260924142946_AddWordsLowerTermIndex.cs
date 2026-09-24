using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <summary>
    /// Expression index for the case-insensitive term lookups (<c>w.Term.ToLower() == key</c> /
    /// <c>keys.Contains(w.Term.ToLower())</c> in WordsController.CreateWord, WordLinker and
    /// SrsUnknownWordCounter). They match on <c>lower("Term")</c> so legacy capitalized rows still
    /// resolve, which the plain (UserId, LanguageId, Term) index can't serve, so each lookup read
    /// every word of the language.
    ///
    /// Deliberately NOT unique: the 2026-02 dedupe kept original casing and case-only duplicate rows
    /// still exist, so a unique build would fail — and Migrate() runs at startup, so the API would
    /// not come up. Raw SQL because EF can't model expression indexes; the model snapshot is unchanged.
    /// </summary>
    public partial class AddWordsLowerTermIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE INDEX IF NOT EXISTS ""IX_Words_UserId_LanguageId_LowerTerm""
                    ON ""Words"" (""UserId"", ""LanguageId"", lower(""Term""));
                ANALYZE ""Words"";
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP INDEX IF EXISTS ""IX_Words_UserId_LanguageId_LowerTerm"";");
        }
    }
}
