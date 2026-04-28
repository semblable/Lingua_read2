using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLibraryUnknownIndicatorSetting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LibraryUnknownIndicator",
                table: "UserSettings",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "both");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LibraryUnknownIndicator",
                table: "UserSettings");
        }
    }
}
