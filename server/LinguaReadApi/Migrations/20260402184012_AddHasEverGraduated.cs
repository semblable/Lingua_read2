using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddHasEverGraduated : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "OldHasEverGraduated",
                table: "SrsReviewLogs",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "HasEverGraduated",
                table: "SrsCardReviews",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Backfill: mark existing graduated cards (repetitions > 0 or
            // not in learning with a prior review date)
            migrationBuilder.Sql(
                """
                UPDATE "SrsCardReviews"
                SET "HasEverGraduated" = true
                WHERE "Repetitions" > 0
                   OR (NOT "IsLearning" AND "LastReviewedAt" IS NOT NULL);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OldHasEverGraduated",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "HasEverGraduated",
                table: "SrsCardReviews");
        }
    }
}
