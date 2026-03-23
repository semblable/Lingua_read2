using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class FixSrsMaxDefaultsWhereZero : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // AddAnkiSrsSettings used defaultValue: 0 for caps, so existing rows got 0 and /srs/due skipped all new/review pools.
            migrationBuilder.Sql(
                """UPDATE "UserSettings" SET "SrsMaxNewCards" = 20 WHERE "SrsMaxNewCards" <= 0;""");
            migrationBuilder.Sql(
                """UPDATE "UserSettings" SET "SrsMaxReviews" = 100 WHERE "SrsMaxReviews" <= 0;""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Cannot know which rows were 0 before the fix; no safe revert.
        }
    }
}
