using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddStatsColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "KnownWords",
                table: "Texts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "StatsUpdatedAt",
                table: "Texts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TotalWords",
                table: "Texts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "StatsUpdatedAt",
                table: "Books",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "KnownWords",
                table: "Texts");

            migrationBuilder.DropColumn(
                name: "StatsUpdatedAt",
                table: "Texts");

            migrationBuilder.DropColumn(
                name: "TotalWords",
                table: "Texts");

            migrationBuilder.DropColumn(
                name: "StatsUpdatedAt",
                table: "Books");
        }
    }
}
