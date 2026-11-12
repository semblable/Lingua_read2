using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AutomaticLessonListeningCredit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "PlaybackPasses",
                table: "LessonStudyEvents",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM "LessonStudyEvents" WHERE "PlaybackPasses" <> 0 LIMIT 1) THEN
                        RAISE EXCEPTION 'Playback study history exists. Preserve/export it before a schema downgrade.';
                    END IF;
                END $$;
                """);
            migrationBuilder.DropColumn(
                name: "PlaybackPasses",
                table: "LessonStudyEvents");
        }
    }
}
