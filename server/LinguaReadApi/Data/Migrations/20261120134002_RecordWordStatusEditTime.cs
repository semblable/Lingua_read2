using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class RecordWordStatusEditTime : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastStatusEditedAt",
                table: "Words",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastStatusEditedAt",
                table: "Words");
        }
    }
}
