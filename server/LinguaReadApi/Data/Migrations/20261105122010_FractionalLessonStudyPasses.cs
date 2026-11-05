using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class FractionalLessonStudyPasses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(name: "ReconcilesSentenceCredit", table: "LessonStudyEvents",
                type: "boolean", nullable: true);
            migrationBuilder.AddColumn<int>(
                name: "PassTenths",
                table: "LessonStudyEvents",
                type: "integer",
                nullable: false,
                defaultValue: 10); // Backfill every existing completed pass as 1.0×.

            migrationBuilder.AddColumn<int>(
                name: "TargetPassTenths",
                table: "LessonStudyEvents",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM "LessonStudyEvents"
                        WHERE "PassTenths" <> 10 OR "TargetPassTenths" IS NOT NULL LIMIT 1) THEN
                        RAISE EXCEPTION 'Fractional study history exists. Preserve/export it before a schema downgrade.';
                    END IF;
                END $$;
                """);
            migrationBuilder.DropColumn(
                name: "ReconcilesSentenceCredit",
                table: "LessonStudyEvents");

            migrationBuilder.DropColumn(
                name: "PassTenths",
                table: "LessonStudyEvents");

            migrationBuilder.DropColumn(
                name: "TargetPassTenths",
                table: "LessonStudyEvents");
        }
    }
}
