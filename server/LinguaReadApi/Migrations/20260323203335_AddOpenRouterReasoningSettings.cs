using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddOpenRouterReasoningSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OpenRouterReasoningEffort",
                table: "UserSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "OpenRouterReasoningEnabled",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OpenRouterReasoningEffort",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "OpenRouterReasoningEnabled",
                table: "UserSettings");
        }
    }
}
