using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddHardcoverIntegration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "HardcoverApiToken",
                table: "UserSettings",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "HardcoverLastSyncAt",
                table: "UserSettings",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HardcoverSyncEnabled",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Author",
                table: "Books",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HardcoverBookId",
                table: "Books",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HardcoverEditionId",
                table: "Books",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "HardcoverLastSyncedAt",
                table: "Books",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "HardcoverMatchedAt",
                table: "Books",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HardcoverUserBookId",
                table: "Books",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HardcoverUserBookReadId",
                table: "Books",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Isbn13",
                table: "Books",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PageCount",
                table: "Books",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Publisher",
                table: "Books",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReleaseDate",
                table: "Books",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Books_UserId_HardcoverBookId",
                table: "Books",
                columns: new[] { "UserId", "HardcoverBookId" },
                unique: true,
                filter: "\"HardcoverBookId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Books_UserId_HardcoverBookId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverApiToken",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "HardcoverLastSyncAt",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "HardcoverSyncEnabled",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "Author",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverBookId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverEditionId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverLastSyncedAt",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverMatchedAt",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverUserBookId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverUserBookReadId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "Isbn13",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "PageCount",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "Publisher",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "ReleaseDate",
                table: "Books");
        }
    }
}
