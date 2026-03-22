using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddEpubRichMedia : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "StructuredContent",
                table: "Texts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CoverImagePath",
                table: "Books",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "StructuredContent",
                table: "Texts");

            migrationBuilder.DropColumn(
                name: "CoverImagePath",
                table: "Books");
        }
    }
}
