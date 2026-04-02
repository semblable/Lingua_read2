using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class UpdateSrsMaxReviewsDefault : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Bump max reviews from old default (100) to new default (200) for users who never changed it.
            migrationBuilder.Sql(
                """UPDATE "UserSettings" SET "SrsMaxReviews" = 200 WHERE "SrsMaxReviews" = 100;""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
