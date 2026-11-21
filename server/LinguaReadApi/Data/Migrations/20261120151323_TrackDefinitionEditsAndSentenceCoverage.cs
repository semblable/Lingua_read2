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

            // Legacy clears removed the translation row. A later status write
            // could replace their timestamp, so use the last known word revision.
            migrationBuilder.Sql("""
                UPDATE "Words" AS word
                SET "LastTranslationEditedAt" = word."LastEditedAt"
                WHERE word."LastTranslationEditedAt" IS NULL AND word."LastEditedAt" IS NOT NULL;
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
