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
            // --- 0. Safe Drops ---
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_Words_UserId\";");
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_TextWords_TextId\";");

            // --- 1. Clean up duplicate TextWords ---
            migrationBuilder.Sql(@"
                DELETE FROM ""TextWords"" a
                USING ""TextWords"" b
                WHERE a.""TextWordId"" > b.""TextWordId""
                AND a.""TextId"" = b.""TextId""
                AND a.""WordId"" = b.""WordId"";
            ");

            // --- 2. Clean up duplicate Words and handle related tables ---
            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    -- Create temporary mapping
                    IF NOT (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wordmappings_temp')) THEN
                        CREATE TEMP TABLE wordmappings_temp AS
                        SELECT w.""WordId"" as OldId, m.MinId as NewId
                        FROM ""Words"" w
                        JOIN (
                            SELECT ""UserId"", ""LanguageId"", LOWER(""Term"") as NormTerm, MIN(""WordId"") as MinId
                            FROM ""Words""
                            GROUP BY ""UserId"", ""LanguageId"", LOWER(""Term"")
                            HAVING COUNT(*) > 1
                        ) m ON w.""UserId"" = m.""UserId"" 
                           AND w.""LanguageId"" = m.""LanguageId"" 
                           AND LOWER(w.""Term"") = m.NormTerm
                        WHERE w.""WordId"" <> m.MinId;

                        -- Handle WordTranslations: Delete translations for 'OldId' if 'NewId' already has one
                        DELETE FROM ""WordTranslations"" wt
                        USING wordmappings_temp wm
                        WHERE wt.""WordId"" = wm.OldId
                        AND EXISTS (SELECT 1 FROM ""WordTranslations"" wt2 WHERE wt2.""WordId"" = wm.NewId);

                        -- Now update remaining WordTranslations to point to the canonical WordId
                        UPDATE ""WordTranslations"" wt
                        SET ""WordId"" = wm.NewId
                        FROM wordmappings_temp wm
                        WHERE wt.""WordId"" = wm.OldId;

                        -- Update TextWords to point to the canonical WordId
                        UPDATE ""TextWords"" tw
                        SET ""WordId"" = wm.NewId
                        FROM wordmappings_temp wm
                        WHERE tw.""WordId"" = wm.OldId;

                        -- Delete the duplicate words
                        DELETE FROM ""Words"" w
                        USING wordmappings_temp wm
                        WHERE w.""WordId"" = wm.OldId;

                        -- Final pass for TextWords duplicates (created by the WordId merge)
                        DELETE FROM ""TextWords"" a
                        USING ""TextWords"" b
                        WHERE a.""TextWordId"" > b.""TextWordId""
                        AND a.""TextId"" = b.""TextId""
                        AND a.""WordId"" = b.""WordId"";

                        DROP TABLE wordmappings_temp;
                    END IF;
                END
                $$;
            ");

            // --- 3. Optional: Ensure IsFinished column exists ---
            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Texts' AND column_name='IsFinished') THEN
                        ALTER TABLE ""Texts"" ADD COLUMN ""IsFinished"" boolean NOT NULL DEFAULT FALSE;
                    END IF;
                END
                $$;
            ");

            // --- 4. Create Unique Indexes ---
            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'IX_Words_UserId_LanguageId_Term' AND n.nspname = 'public') THEN
                         DROP INDEX IF EXISTS ""IX_Words_UserId_LanguageId_Term"";
                         CREATE UNIQUE INDEX ""IX_Words_UserId_LanguageId_Term"" ON ""Words"" (""UserId"", ""LanguageId"", ""Term"");
                    END IF;
                END
                $$;
            ");

            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'IX_TextWords_TextId_WordId' AND n.nspname = 'public') THEN
                         DROP INDEX IF EXISTS ""IX_TextWords_TextId_WordId"";
                         CREATE UNIQUE INDEX ""IX_TextWords_TextId_WordId"" ON ""TextWords"" (""TextId"", ""WordId"");
                    END IF;
                END
                $$;
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
