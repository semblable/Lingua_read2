using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTextSegmentationProfile : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SegmentationProfile",
                table: "Texts",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // App rollback may retain this additive column. Dropping it from an
            // opted-in text would silently change its vocabulary boundaries.
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM "Texts" WHERE "SegmentationProfile" IS NOT NULL LIMIT 1) THEN
                        RAISE EXCEPTION 'Profiled texts exist. Preserve/export their segmentation profiles before a schema downgrade; app rollback may retain this column.';
                    END IF;
                END $$;
                """);
            migrationBuilder.DropColumn(
                name: "SegmentationProfile",
                table: "Texts");
        }
    }
}
