using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class PersistHardcoverSyncIntent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "HardcoverAutoMatchDisabled",
                table: "Books",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "HardcoverPendingFinishAfterReadId",
                table: "Books",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "HardcoverPendingRating",
                table: "Books",
                type: "numeric(2,1)",
                precision: 2,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HardcoverPendingRatingBookId",
                table: "Books",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "HardcoverPendingRatingId",
                table: "Books",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Books_PendingHardcoverSync",
                table: "Books",
                column: "BookId",
                filter: "\"HardcoverPendingRatingId\" IS NOT NULL OR \"HardcoverPendingFinishAfterReadId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Books_PendingHardcoverSync",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverAutoMatchDisabled",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverPendingFinishAfterReadId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverPendingRating",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverPendingRatingBookId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "HardcoverPendingRatingId",
                table: "Books");
        }
    }
}
