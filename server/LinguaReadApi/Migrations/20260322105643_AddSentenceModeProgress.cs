using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddSentenceModeProgress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SentenceAudioRepeats",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "SentenceMode",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "UserSentenceProgresses",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TextId = table.Column<int>(type: "integer", nullable: false),
                    CreditedSegmentIndicesJson = table.Column<string>(type: "text", nullable: false),
                    CreditedWordCount = table.Column<int>(type: "integer", nullable: false),
                    LastSegmentIndex = table.Column<int>(type: "integer", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserSentenceProgresses", x => new { x.UserId, x.TextId });
                    table.ForeignKey(
                        name: "FK_UserSentenceProgresses_Texts_TextId",
                        column: x => x.TextId,
                        principalTable: "Texts",
                        principalColumn: "TextId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserSentenceProgresses_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserSentenceProgresses_TextId",
                table: "UserSentenceProgresses",
                column: "TextId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserSentenceProgresses");

            migrationBuilder.DropColumn(
                name: "SentenceAudioRepeats",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SentenceMode",
                table: "UserSettings");
        }
    }
}
