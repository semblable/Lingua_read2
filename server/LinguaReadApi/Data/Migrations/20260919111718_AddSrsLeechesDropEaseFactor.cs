using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSrsLeechesDropEaseFactor : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // SM-2 ease is unused since the move to FSRS (stability/difficulty). A card the
            // FSRS backfill converts without any review history now starts at difficulty 5
            // instead of one derived from ease, so the drop is safe even when this migration
            // ships together with AddFsrsScheduling.
            migrationBuilder.DropColumn(
                name: "OldEaseFactor",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "EaseFactor",
                table: "SrsCardReviews");

            migrationBuilder.AddColumn<string>(
                name: "SrsLeechAction",
                table: "UserSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "tag");

            migrationBuilder.AddColumn<int>(
                name: "SrsLeechThreshold",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 8);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SrsLeechAction",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsLeechThreshold",
                table: "UserSettings");

            migrationBuilder.AddColumn<double>(
                name: "OldEaseFactor",
                table: "SrsReviewLogs",
                type: "double precision",
                nullable: false,
                defaultValue: 2.5);

            migrationBuilder.AddColumn<double>(
                name: "EaseFactor",
                table: "SrsCardReviews",
                type: "double precision",
                nullable: false,
                defaultValue: 2.5);
        }
    }
}
