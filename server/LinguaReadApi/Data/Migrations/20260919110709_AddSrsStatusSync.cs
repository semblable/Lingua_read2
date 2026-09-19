using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSrsStatusSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SrsAutoCreateCards",
                table: "UserSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "always");

            migrationBuilder.AddColumn<int>(
                name: "SrsAutoKnownDays",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "SrsKnownCardAction",
                table: "UserSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "keep");

            migrationBuilder.AddColumn<int>(
                name: "SrsStatusLevel3Days",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 7);

            migrationBuilder.AddColumn<int>(
                name: "SrsStatusLevel4Days",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 21);

            migrationBuilder.AddColumn<string>(
                name: "SrsStatusSyncMode",
                table: "UserSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "promote");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SrsAutoCreateCards",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsAutoKnownDays",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsKnownCardAction",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsStatusLevel3Days",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsStatusLevel4Days",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsStatusSyncMode",
                table: "UserSettings");
        }
    }
}
