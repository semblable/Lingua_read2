using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddDiscordReportScheduleSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DiscordTimezoneOffsetMinutes",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "DiscordWeeklyReportDayOfWeek",
                table: "UserSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Monday");

            migrationBuilder.AddColumn<int>(
                name: "DiscordWeeklyReportHourLocal",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 8);

            migrationBuilder.AddColumn<DateTime>(
                name: "DiscordWeeklyReportLastSentAt",
                table: "UserSettings",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DiscordTimezoneOffsetMinutes",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "DiscordWeeklyReportDayOfWeek",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "DiscordWeeklyReportHourLocal",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "DiscordWeeklyReportLastSentAt",
                table: "UserSettings");
        }
    }
}
