using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddSrsPhase3MediumComplexityFeatures : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SrsLearningStepMinutes",
                table: "UserSettings",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "OldCurrentLearningStepIndex",
                table: "SrsReviewLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "OldIsLearning",
                table: "SrsReviewLogs",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "BuriedUntil",
                table: "SrsCardReviews",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CurrentLearningStepIndex",
                table: "SrsCardReviews",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Flag",
                table: "SrsCardReviews",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "IsLearning",
                table: "SrsCardReviews",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsSuspended",
                table: "SrsCardReviews",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Tags",
                table: "SrsCardReviews",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SrsLearningStepMinutes",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "OldCurrentLearningStepIndex",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "OldIsLearning",
                table: "SrsReviewLogs");

            migrationBuilder.DropColumn(
                name: "BuriedUntil",
                table: "SrsCardReviews");

            migrationBuilder.DropColumn(
                name: "CurrentLearningStepIndex",
                table: "SrsCardReviews");

            migrationBuilder.DropColumn(
                name: "Flag",
                table: "SrsCardReviews");

            migrationBuilder.DropColumn(
                name: "IsLearning",
                table: "SrsCardReviews");

            migrationBuilder.DropColumn(
                name: "IsSuspended",
                table: "SrsCardReviews");

            migrationBuilder.DropColumn(
                name: "Tags",
                table: "SrsCardReviews");
        }
    }
}
