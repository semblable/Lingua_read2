using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <summary>
    /// Replaces the OpenRouter-only settings with per-provider rows (UserAiProviders) and a selected
    /// provider (UserSettings.AiProvider). Existing OpenRouter settings become an "openrouter" row
    /// and a user who had OpenRouter switched on keeps it selected. The API key is copied as stored:
    /// both places use the same Data Protection purpose, so the ciphertext stays readable.
    /// </summary>
    public partial class AddAiProviders : Migration
    {
        private const string LegacyOpenRouterDefaultModel = "google/gemini-2.5-flash-preview-05-20:free";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AiProvider",
                table: "UserSettings",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "gemini");

            migrationBuilder.CreateTable(
                name: "UserAiProviders",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ApiKey = table.Column<string>(type: "text", nullable: true),
                    BaseUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Model = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    TranslationModel = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ExplanationModel = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    StoryModel = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SummarizationModel = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserAiProviders", x => new { x.UserId, x.Provider });
                    table.ForeignKey(
                        name: "FK_UserAiProviders_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Only users who touched the OpenRouter settings get a row; everyone else just has the
            // untouched defaults.
            migrationBuilder.Sql($"""
                INSERT INTO "UserAiProviders"
                    ("UserId", "Provider", "ApiKey", "Model",
                     "TranslationModel", "ExplanationModel", "StoryModel", "SummarizationModel")
                SELECT "UserId", 'openrouter', NULLIF("OpenRouterApiKey", ''), NULLIF(btrim("OpenRouterModel"), ''),
                       "OpenRouterTranslationModel", "OpenRouterExplanationModel", "OpenRouterStoryModel", "OpenRouterSummarizationModel"
                FROM "UserSettings"
                WHERE "UseOpenRouter"
                   OR NULLIF("OpenRouterApiKey", '') IS NOT NULL
                   OR "OpenRouterModel" <> '{LegacyOpenRouterDefaultModel}'
                   OR "OpenRouterTranslationModel" IS NOT NULL
                   OR "OpenRouterExplanationModel" IS NOT NULL
                   OR "OpenRouterStoryModel" IS NOT NULL
                   OR "OpenRouterSummarizationModel" IS NOT NULL;

                UPDATE "UserSettings" SET "AiProvider" = 'openrouter' WHERE "UseOpenRouter";
                """);

            migrationBuilder.DropColumn(
                name: "OpenRouterApiKey",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "OpenRouterExplanationModel",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "OpenRouterModel",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "OpenRouterStoryModel",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "OpenRouterSummarizationModel",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "OpenRouterTranslationModel",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "UseOpenRouter",
                table: "UserSettings");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OpenRouterApiKey",
                table: "UserSettings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OpenRouterExplanationModel",
                table: "UserSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OpenRouterModel",
                table: "UserSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: LegacyOpenRouterDefaultModel);

            migrationBuilder.AddColumn<string>(
                name: "OpenRouterStoryModel",
                table: "UserSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OpenRouterSummarizationModel",
                table: "UserSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OpenRouterTranslationModel",
                table: "UserSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "UseOpenRouter",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Only OpenRouter settings survive a downgrade; other providers' rows are dropped.
            migrationBuilder.Sql($"""
                UPDATE "UserSettings" s
                SET "OpenRouterApiKey" = p."ApiKey",
                    "OpenRouterModel" = left(COALESCE(p."Model", '{LegacyOpenRouterDefaultModel}'), 100),
                    "OpenRouterTranslationModel" = left(p."TranslationModel", 100),
                    "OpenRouterExplanationModel" = left(p."ExplanationModel", 100),
                    "OpenRouterStoryModel" = left(p."StoryModel", 100),
                    "OpenRouterSummarizationModel" = left(p."SummarizationModel", 100)
                FROM "UserAiProviders" p
                WHERE p."UserId" = s."UserId" AND p."Provider" = 'openrouter';

                UPDATE "UserSettings" SET "UseOpenRouter" = ("AiProvider" = 'openrouter');
                """);

            migrationBuilder.DropTable(
                name: "UserAiProviders");

            migrationBuilder.DropColumn(
                name: "AiProvider",
                table: "UserSettings");
        }
    }
}
