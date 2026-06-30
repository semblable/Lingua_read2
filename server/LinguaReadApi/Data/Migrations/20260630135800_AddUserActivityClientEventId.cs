using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUserActivityClientEventId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ClientEventId",
                table: "UserActivities",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserActivities_UserId_ClientEventId",
                table: "UserActivities",
                columns: new[] { "UserId", "ClientEventId" },
                unique: true,
                filter: "\"ClientEventId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_UserActivities_UserId_ClientEventId",
                table: "UserActivities");

            migrationBuilder.DropColumn(
                name: "ClientEventId",
                table: "UserActivities");
        }
    }
}
