using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <summary>
    /// Paragraph spacing joins line spacing on the server, so it follows the user across devices.
    /// Until now it lived only in this browser's cache, where each reload reset it to Normal.
    /// Existing rows start at 1.0 (Normal), the model default.
    /// </summary>
    public partial class AddParagraphSpacingSetting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "ParagraphSpacing",
                table: "UserSettings",
                type: "double precision",
                nullable: false,
                defaultValue: 1.0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ParagraphSpacing",
                table: "UserSettings");
        }
    }
}
