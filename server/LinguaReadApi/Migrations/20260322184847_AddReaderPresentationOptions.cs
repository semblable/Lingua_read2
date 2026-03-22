using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddReaderPresentationOptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "ReaderParagraphIndent",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "ReaderTextAlignment",
                table: "UserSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "left");

            migrationBuilder.AddColumn<bool>(
                name: "ShowWordInfoPanel",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReaderParagraphIndent",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "ReaderTextAlignment",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "ShowWordInfoPanel",
                table: "UserSettings");
        }
    }
}
