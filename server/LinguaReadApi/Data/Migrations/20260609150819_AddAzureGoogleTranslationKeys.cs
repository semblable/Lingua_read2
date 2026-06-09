using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAzureGoogleTranslationKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AzureTranslatorKey",
                table: "UserSettings",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AzureTranslatorRegion",
                table: "UserSettings",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GoogleTranslateApiKey",
                table: "UserSettings",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AzureTranslatorKey",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "AzureTranslatorRegion",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "GoogleTranslateApiKey",
                table: "UserSettings");
        }
    }
}
