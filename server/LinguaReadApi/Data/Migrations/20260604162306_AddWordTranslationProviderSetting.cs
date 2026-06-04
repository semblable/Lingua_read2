using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWordTranslationProviderSetting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "WiktionaryRichDisplay",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "WordTranslationProvider",
                table: "UserSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "deepl");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WiktionaryRichDisplay",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "WordTranslationProvider",
                table: "UserSettings");
        }
    }
}
