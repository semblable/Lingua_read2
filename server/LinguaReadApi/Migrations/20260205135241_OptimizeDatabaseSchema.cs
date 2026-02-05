using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class OptimizeDatabaseSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                -- 1. Preparation: Remove any current TextWords duplicates if they somehow exist
                DELETE FROM ""TextWords"" a
                USING ""TextWords"" b
                WHERE a.""TextWordId"" > b.""TextWordId""
                AND a.""TextId"" = b.""TextId""
                AND a.""WordId"" = b.""WordId"";

                -- 2. Word & Translation Merge Map
                -- We identify 'winners' and 'losers' for each logical word group
                DROP TABLE IF EXISTS word_merge_map;
                CREATE TEMP TABLE word_merge_map AS
                SELECT w.""WordId"" as old_id, m.min_id as new_id
                FROM ""Words"" w
                JOIN (
                    SELECT ""UserId"", ""LanguageId"", TRIM(LOWER(""Term"")) as norm_term, MIN(""WordId"") as min_id
                    FROM ""Words""
                    GROUP BY ""UserId"", ""LanguageId"", TRIM(LOWER(""Term""))
                    HAVING COUNT(*) > 1
                ) m ON w.""UserId"" = m.""UserId"" 
                   AND w.""LanguageId"" = m.""LanguageId"" 
                   AND TRIM(LOWER(w.""Term"")) = m.norm_term
                WHERE w.""WordId"" <> m.min_id;

                -- 3. Resolve WordTranslations collisions
                -- If both 'old' and 'new' words have translations, we must keep only the best one
                DELETE FROM ""WordTranslations"" wt
                USING word_merge_map wm
                WHERE wt.""WordId"" = wm.old_id
                AND EXISTS (SELECT 1 FROM ""WordTranslations"" wt2 WHERE wt2.""WordId"" = wm.new_id);

                -- Re-link remaining translations to the winner WordId
                UPDATE ""WordTranslations"" wt
                SET ""WordId"" = wm.new_id
                FROM word_merge_map wm
                WHERE wt.""WordId"" = wm.old_id;

                -- 4. CRITICAL: Resolve TextWords conflicts
                -- Before we update TextWords, we must delete entries where a link already exists for the 'new' word
                -- To prevent Unique Constraint Violation on (TextId, WordId)
                DELETE FROM ""TextWords"" tw
                USING word_merge_map wm
                WHERE tw.""WordId"" = wm.old_id
                AND EXISTS (
                    SELECT 1 
                    FROM ""TextWords"" tw2 
                    WHERE tw2.""TextId"" = tw.""TextId"" 
                    AND tw2.""WordId"" = wm.new_id
                );

                -- Now safe to re-link all remaining TextWords
                UPDATE ""TextWords"" tw
                SET ""WordId"" = wm.new_id
                FROM word_merge_map wm
                WHERE tw.""WordId"" = wm.old_id;

                -- 5. Final Cleanup
                -- Delete duplicate Words
                DELETE FROM ""Words"" w
                USING word_merge_map wm
                WHERE w.""WordId"" = wm.old_id;

                DROP TABLE IF EXISTS word_merge_map;

                -- 6. Schema Upgrades (Idempotent)
                ALTER TABLE ""Texts"" ADD COLUMN IF NOT EXISTS ""IsFinished"" boolean NOT NULL DEFAULT FALSE;

                DROP INDEX IF EXISTS ""IX_Words_UserId"";
                DROP INDEX IF EXISTS ""IX_Words_UserId_LanguageId_Term"";
                CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Words_UserId_LanguageId_Term"" ON ""Words"" (""UserId"", ""LanguageId"", ""Term"");

                DROP INDEX IF EXISTS ""IX_TextWords_TextId"";
                DROP INDEX IF EXISTS ""IX_TextWords_TextId_WordId"";
                CREATE UNIQUE INDEX IF NOT EXISTS ""IX_TextWords_TextId_WordId"" ON ""TextWords"" (""TextId"", ""WordId"");
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Words_UserId_LanguageId_Term",
                table: "Words");

            migrationBuilder.DropIndex(
                name: "IX_TextWords_TextId_WordId",
                table: "TextWords");

            migrationBuilder.DropColumn(
                name: "IsFinished",
                table: "Texts");

            migrationBuilder.CreateIndex(
                name: "IX_Words_UserId",
                table: "Words",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_TextWords_TextId",
                table: "TextWords",
                column: "TextId");
        }
    }
}
