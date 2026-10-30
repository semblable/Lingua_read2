using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLessonStudyEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LessonStudyEvents",
                columns: table => new
                {
                    LessonStudyEventId = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceTextId = table.Column<int>(type: "integer", nullable: false),
                    SourceTitle = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    LanguageId = table.Column<int>(type: "integer", nullable: false),
                    SourceRevision = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ClientEventId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Kind = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    CreditedWords = table.Column<int>(type: "integer", nullable: false),
                    CreditedListeningSeconds = table.Column<int>(type: "integer", nullable: false),
                    CountingVersion = table.Column<int>(type: "integer", nullable: false),
                    CountsTowardStatistics = table.Column<bool>(type: "boolean", nullable: false),
                    IsCompletionCheckpoint = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LessonStudyEvents", x => x.LessonStudyEventId);
                    table.ForeignKey(
                        name: "FK_LessonStudyEvents_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LessonStudyEvents_UserId_ClientEventId",
                table: "LessonStudyEvents",
                columns: new[] { "UserId", "ClientEventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LessonStudyEvents_UserId_SourceTextId_Kind",
                table: "LessonStudyEvents",
                columns: new[] { "UserId", "SourceTextId", "Kind" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // App rollback keeps this additive table. A schema downgrade must not
            // silently destroy newly recorded action identities or credit history.
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM "LessonStudyEvents" LIMIT 1) THEN
                        RAISE EXCEPTION 'Lesson study history exists. Preserve/export it before a schema downgrade; app rollback may retain this table.';
                    END IF;
                END $$;
                """);
            migrationBuilder.DropTable(
                name: "LessonStudyEvents");
        }
    }
}
