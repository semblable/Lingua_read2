using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSrsNewCardOrderingAndLimitGuardrails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SrsNewCardOrder",
                table: "UserSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "recent_frequent");

            migrationBuilder.AddColumn<bool>(
                name: "SrsNewCardsIgnoreReviewLimit",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SrsNewCardOrder",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "SrsNewCardsIgnoreReviewLimit",
                table: "UserSettings");
        }
    }
}
