using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class RecordReviewAndStudyHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastManualStatusAt",
                table: "Words",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "WordStatusIntentAt",
                table: "SrsReviewLogs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ReadingVolumeWords",
                table: "LessonStudyEvents",
                type: "bigint",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastManualStatusAt",
                table: "Words");

            migrationBuilder.DropColumn(
                name: "WordStatusIntentAt",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "ReadingVolumeWords",
                table: "LessonStudyEvents");
        }
    }
}
