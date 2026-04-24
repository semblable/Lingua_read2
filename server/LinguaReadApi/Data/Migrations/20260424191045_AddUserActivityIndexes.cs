using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUserActivityIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_UserActivities_UserId_LanguageId_Timestamp",
                table: "UserActivities",
                columns: new[] { "UserId", "LanguageId", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_UserActivities_UserId_Timestamp",
                table: "UserActivities",
                columns: new[] { "UserId", "Timestamp" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_UserActivities_UserId_LanguageId_Timestamp",
                table: "UserActivities");

            migrationBuilder.DropIndex(
                name: "IX_UserActivities_UserId_Timestamp",
                table: "UserActivities");
        }
    }
}
