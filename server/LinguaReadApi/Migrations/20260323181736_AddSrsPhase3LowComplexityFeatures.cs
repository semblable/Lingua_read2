using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddSrsPhase3LowComplexityFeatures : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SrsCurrentStreak",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SrsLongestStreak",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "SrsReviewLogs",
                columns: table => new
                {
                    SrsReviewLogId = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SrsCardReviewId = table.Column<int>(type: "integer", nullable: false),
                    Grade = table.Column<int>(type: "integer", nullable: false),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    OldInterval = table.Column<int>(type: "integer", nullable: false),
                    OldEaseFactor = table.Column<double>(type: "double precision", nullable: false),
                    OldRepetitions = table.Column<int>(type: "integer", nullable: false),
                    OldNextReviewAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SrsReviewLogs", x => x.SrsReviewLogId);
                    table.ForeignKey(
                        name: "FK_SrsReviewLogs_SrsCardReviews_SrsCardReviewId",
                        column: x => x.SrsCardReviewId,
                        principalTable: "SrsCardReviews",
                        principalColumn: "SrsCardReviewId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SrsReviewLogs_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SrsReviewLogs_SrsCardReviewId",
                table: "SrsReviewLogs",
                column: "SrsCardReviewId");

            migrationBuilder.CreateIndex(
                name: "IX_SrsReviewLogs_UserId",
                table: "SrsReviewLogs",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "SrsCurrentStreak",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsLongestStreak",
                table: "UserSettings");
        }
    }
}
