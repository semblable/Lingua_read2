using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddSrsCardReviewUserIdNextReviewAtIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_SrsCardReviews_UserId_NextReviewAt",
                table: "SrsCardReviews",
                columns: new[] { "UserId", "NextReviewAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SrsCardReviews_UserId_NextReviewAt",
                table: "SrsCardReviews");
        }
    }
}
