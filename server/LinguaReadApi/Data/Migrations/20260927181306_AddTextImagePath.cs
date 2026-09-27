using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <summary>
    /// Texts.ImagePath: the picture the Library shows on a text's card (a news article's lead
    /// photo). Articles imported before this take it from the image block the importer put first
    /// in their StructuredContent.
    /// </summary>
    public partial class AddTextImagePath : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ImagePath",
                table: "Texts",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            // Only news articles (SourceUrl) whose StructuredContent starts with an image block, the
            // shape NewsFeedImporter writes, so the jsonb cast only ever sees JSON it wrote; the
            // CASE keeps anything but a news photo path out.
            migrationBuilder.Sql(@"
                UPDATE ""Texts""
                SET ""ImagePath"" = CASE
                    WHEN (""StructuredContent""::jsonb -> 0 ->> 'imageUrl') LIKE 'epub_assets/%/news/%'
                        AND length(""StructuredContent""::jsonb -> 0 ->> 'imageUrl') <= 500
                    THEN ""StructuredContent""::jsonb -> 0 ->> 'imageUrl'
                END
                WHERE ""SourceUrl"" IS NOT NULL
                  AND ""StructuredContent"" LIKE '[{""type"":""image""%';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ImagePath",
                table: "Texts");
        }
    }
}
