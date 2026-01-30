using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddOpenRouterSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "UseOpenRouter",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "OpenRouterApiKey",
                table: "UserSettings",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OpenRouterModel",
                table: "UserSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "google/gemini-2.5-flash-preview-05-20:free");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UseOpenRouter",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "OpenRouterApiKey",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "OpenRouterModel",
                table: "UserSettings");
        }
    }
}
