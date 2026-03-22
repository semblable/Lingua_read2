using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddReaderLayoutOptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ReaderContentWidth",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 740);

            migrationBuilder.AddColumn<string>(
                name: "ReadingDensity",
                table: "UserSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "balanced");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReaderContentWidth",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "ReadingDensity",
                table: "UserSettings");
        }
    }
}
