using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddAnkiSrsSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SrsDailyNewCardsStudied",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SrsDailyReviewsStudied",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "SrsDailyStudyDate",
                table: "UserSettings",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SrsMaxNewCards",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SrsMaxReviews",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "SrsReviewOrder",
                table: "UserSettings",
                type: "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SrsDailyNewCardsStudied",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsDailyReviewsStudied",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsDailyStudyDate",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsMaxNewCards",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsMaxReviews",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsReviewOrder",
                table: "UserSettings");
        }
    }
}
