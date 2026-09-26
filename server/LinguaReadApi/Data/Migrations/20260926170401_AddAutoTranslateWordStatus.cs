using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <summary>
    /// The status given to new words saved by "translate unknown words" (the reader's Auto button
    /// and translate-on-open). Existing rows start at 5 (Known), which is what those words always
    /// got before.
    /// </summary>
    public partial class AddAutoTranslateWordStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AutoTranslateWordStatus",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 5);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AutoTranslateWordStatus",
                table: "UserSettings");
        }
    }
}
