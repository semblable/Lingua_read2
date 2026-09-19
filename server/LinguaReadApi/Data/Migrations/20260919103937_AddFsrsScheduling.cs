using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFsrsScheduling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SrsReviewLogs_SrsCardReviewId",
                table: "SrsReviewLogs");

            migrationBuilder.DropIndex(
                name: "IX_SrsReviewLogs_UserId",
                table: "SrsReviewLogs");

            migrationBuilder.AddColumn<int>(
                name: "SrsDayStartHour",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 4);

            migrationBuilder.AddColumn<double>(
                name: "SrsDesiredRetention",
                table: "UserSettings",
                type: "double precision",
                nullable: false,
                defaultValue: 0.9);

            migrationBuilder.AddColumn<string>(
                name: "SrsFsrsWeights",
                table: "UserSettings",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SrsRelearningStepMinutes",
                table: "UserSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "10");

            migrationBuilder.AddColumn<string>(
                name: "ClientEventId",
                table: "SrsReviewLogs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Kind",
                table: "SrsReviewLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "NewInterval",
                table: "SrsReviewLogs",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "OldDifficulty",
                table: "SrsReviewLogs",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OldLapses",
                table: "SrsReviewLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<double>(
                name: "OldStability",
                table: "SrsReviewLogs",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WordStatusBefore",
                table: "SrsReviewLogs",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Difficulty",
                table: "SrsCardReviews",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Lapses",
                table: "SrsCardReviews",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<double>(
                name: "Stability",
                table: "SrsCardReviews",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SuspendReason",
                table: "SrsCardReviews",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            // Record why already-suspended cards are suspended, so un-ignoring a word lifts
            // only the automatic suspension and leaves hand-suspended cards alone.
            migrationBuilder.Sql(@"
                UPDATE ""SrsCardReviews"" AS c
                SET ""SuspendReason"" = CASE WHEN w.""Status"" = 6 THEN 'ignored' ELSE 'manual' END
                FROM ""Words"" AS w
                WHERE w.""WordId"" = c.""WordId"" AND c.""IsSuspended"";");

            migrationBuilder.CreateIndex(
                name: "IX_SrsReviewLogs_SrsCardReviewId_ReviewedAt",
                table: "SrsReviewLogs",
                columns: new[] { "SrsCardReviewId", "ReviewedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_SrsReviewLogs_UserId_ClientEventId",
                table: "SrsReviewLogs",
                columns: new[] { "UserId", "ClientEventId" },
                unique: true,
                filter: "\"ClientEventId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SrsReviewLogs_UserId_ReviewedAt",
                table: "SrsReviewLogs",
                columns: new[] { "UserId", "ReviewedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SrsReviewLogs_SrsCardReviewId_ReviewedAt",
                table: "SrsReviewLogs");

            migrationBuilder.DropIndex(
                name: "IX_SrsReviewLogs_UserId_ClientEventId",
                table: "SrsReviewLogs");

            migrationBuilder.DropIndex(
                name: "IX_SrsReviewLogs_UserId_ReviewedAt",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "SrsDayStartHour",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsDesiredRetention",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsFsrsWeights",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsRelearningStepMinutes",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "ClientEventId",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "NewInterval",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "OldDifficulty",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "OldLapses",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "OldStability",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "WordStatusBefore",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "Difficulty",
                table: "SrsCardReviews");

            migrationBuilder.DropColumn(
                name: "Lapses",
                table: "SrsCardReviews");

            migrationBuilder.DropColumn(
                name: "Stability",
                table: "SrsCardReviews");

            migrationBuilder.DropColumn(
                name: "SuspendReason",
                table: "SrsCardReviews");

            migrationBuilder.CreateIndex(
                name: "IX_SrsReviewLogs_SrsCardReviewId",
                table: "SrsReviewLogs",
                column: "SrsCardReviewId");

            migrationBuilder.CreateIndex(
                name: "IX_SrsReviewLogs_UserId",
                table: "SrsReviewLogs",
                column: "UserId");
        }
    }
}
