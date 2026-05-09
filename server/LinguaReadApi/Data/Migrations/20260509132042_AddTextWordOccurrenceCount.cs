using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTextWordOccurrenceCount : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // defaultValue 1 so existing TextWord rows aggregate to the
            // legacy unique-word count until the tokenizer-version bump
            // re-links them with real occurrence counts.
            migrationBuilder.AddColumn<int>(
                name: "OccurrenceCount",
                table: "TextWords",
                type: "integer",
                nullable: false,
                defaultValue: 1);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OccurrenceCount",
                table: "TextWords");
        }
    }
}
