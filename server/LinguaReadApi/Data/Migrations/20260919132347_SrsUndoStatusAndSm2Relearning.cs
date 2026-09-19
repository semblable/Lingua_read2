using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class SrsUndoStatusAndSm2Relearning : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "WordStatusAfter",
                table: "SrsReviewLogs",
                type: "integer",
                nullable: true);

            // SM-2 only set HasEverGraduated when a card left the learning steps, so a card
            // that went straight to review and then lapsed came back as a plain learning card,
            // and the FSRS backfill carried that over: such cards use the learning steps instead
            // of the relearning ones and skip the lapse minimum interval. A learning review of
            // a card that had been in review before (a log whose card was not learning and had
            // been reviewed) is a relearning review; fix those logs, then the cards themselves.
            migrationBuilder.Sql(@"
                UPDATE ""SrsReviewLogs"" AS l
                SET ""OldHasEverGraduated"" = TRUE,
                    ""Kind"" = CASE WHEN l.""Kind"" = 0 THEN 2 ELSE l.""Kind"" END
                WHERE l.""OldIsLearning"" AND NOT l.""OldHasEverGraduated""
                  AND EXISTS (
                      SELECT 1 FROM ""SrsReviewLogs"" AS p
                      WHERE p.""SrsCardReviewId"" = l.""SrsCardReviewId""
                        AND NOT p.""OldIsLearning"" AND p.""OldLastReviewedAt"" IS NOT NULL
                        AND (p.""ReviewedAt"", p.""SrsReviewLogId"") < (l.""ReviewedAt"", l.""SrsReviewLogId""));");

            migrationBuilder.Sql(@"
                UPDATE ""SrsCardReviews"" AS c
                SET ""HasEverGraduated"" = TRUE
                WHERE c.""IsLearning"" AND NOT c.""HasEverGraduated""
                  AND EXISTS (
                      SELECT 1 FROM ""SrsReviewLogs"" AS l
                      WHERE l.""SrsCardReviewId"" = c.""SrsCardReviewId""
                        AND NOT l.""OldIsLearning"" AND l.""OldLastReviewedAt"" IS NOT NULL);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The HasEverGraduated/Kind corrections are left in place: they fix data, not schema.
            migrationBuilder.DropColumn(
                name: "WordStatusAfter",
                table: "SrsReviewLogs");
        }
    }
}
