using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class TrackDefinitionEditsAndSentenceCoverage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastTranslationEditedAt",
                table: "Words",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceCoverageJson",
                table: "UserSentenceProgresses",
                type: "text",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "Words" AS word
                SET "LastTranslationEditedAt" = LEAST(word."LastEditedAt", COALESCE(translation."UpdatedAt", translation."CreatedAt"))
                FROM "WordTranslations" AS translation
                WHERE word."WordId" = translation."WordId";
                """);

            // A word with no translation row can still have a recent explicit clear.
            migrationBuilder.Sql("""
                UPDATE "Words" AS word
                SET "LastTranslationEditedAt" = word."LastEditedAt"
                WHERE word."LastTranslationEditedAt" IS NULL AND word."LastEditedAt" IS NOT NULL
                    AND (word."LastStatusEditedAt" IS NULL OR word."LastStatusEditedAt" < word."LastEditedAt");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastTranslationEditedAt",
                table: "Words");

            migrationBuilder.DropColumn(
                name: "SourceCoverageJson",
                table: "UserSentenceProgresses");
        }
    }
}
