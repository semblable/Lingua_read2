using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPerTaskOpenRouterModelsAndPrompts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CustomExplanationPrompt",
                table: "UserSettings",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CustomStoryPrompt",
                table: "UserSettings",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CustomSummarizationPrompt",
                table: "UserSettings",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CustomTranslationPrompt",
                table: "UserSettings",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OpenRouterExplanationModel",
                table: "UserSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CustomExplanationPrompt",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "CustomStoryPrompt",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "CustomSummarizationPrompt",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "CustomTranslationPrompt",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "OpenRouterExplanationModel",
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
        }
    }
}
