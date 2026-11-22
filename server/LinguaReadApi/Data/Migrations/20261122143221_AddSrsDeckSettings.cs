using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSrsDeckSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "StudyDay",
                table: "SrsReviewLogs",
                type: "date",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "SrsDeckSettings",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LanguageId = table.Column<int>(type: "integer", nullable: false),
                    MaxNewCards = table.Column<int>(type: "integer", nullable: true),
                    MaxReviews = table.Column<int>(type: "integer", nullable: true),
                    NewCardsIgnoreReviewLimit = table.Column<bool>(type: "boolean", nullable: true),
                    TodayStudyDay = table.Column<DateOnly>(type: "date", nullable: true),
                    TodayExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TodayMaxNewCards = table.Column<int>(type: "integer", nullable: true),
                    TodayMaxReviews = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SrsDeckSettings", x => new { x.UserId, x.LanguageId });
                    table.ForeignKey(
                        name: "FK_SrsDeckSettings_Languages_LanguageId",
                        column: x => x.LanguageId,
                        principalTable: "Languages",
                        principalColumn: "LanguageId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SrsDeckSettings_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SrsDeckStudyEntries",
                columns: table => new
                {
                    SrsDeckStudyEntryId = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LanguageId = table.Column<int>(type: "integer", nullable: false),
                    StudyDay = table.Column<DateOnly>(type: "date", nullable: false),
                    IsNewCard = table.Column<bool>(type: "boolean", nullable: false),
                    SrsReviewLogId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SrsDeckStudyEntries", x => x.SrsDeckStudyEntryId);
                    table.ForeignKey(
                        name: "FK_SrsDeckStudyEntries_Languages_LanguageId",
                        column: x => x.LanguageId,
                        principalTable: "Languages",
                        principalColumn: "LanguageId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SrsDeckStudyEntries_SrsReviewLogs_SrsReviewLogId",
                        column: x => x.SrsReviewLogId,
                        principalTable: "SrsReviewLogs",
                        principalColumn: "SrsReviewLogId",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_SrsDeckStudyEntries_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SrsDeckSettings_LanguageId",
                table: "SrsDeckSettings",
                column: "LanguageId");

            migrationBuilder.CreateIndex(
                name: "IX_SrsDeckStudyEntries_LanguageId",
                table: "SrsDeckStudyEntries",
                column: "LanguageId");

            migrationBuilder.CreateIndex(
                name: "IX_SrsDeckStudyEntries_SrsReviewLogId",
                table: "SrsDeckStudyEntries",
                column: "SrsReviewLogId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SrsDeckStudyEntries_UserId_StudyDay_LanguageId",
                table: "SrsDeckStudyEntries",
                columns: new[] { "UserId", "StudyDay", "LanguageId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SrsDeckSettings");

            migrationBuilder.DropTable(
                name: "SrsDeckStudyEntries");

            migrationBuilder.DropColumn(
                name: "StudyDay",
                table: "SrsReviewLogs");
        }
    }
}
