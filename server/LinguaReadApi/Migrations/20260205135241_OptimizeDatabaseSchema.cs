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
            migrationBuilder.DropIndex(
                name: "IX_Words_UserId",
                table: "Words");

            // 1. Clean up duplicate TextWords *before* creating the unique index
            // Keep the one with the smallest TextWordId
            migrationBuilder.Sql(@"
                DELETE FROM ""TextWords"" a
                USING ""TextWords"" b
                WHERE a.""TextWordId"" > b.""TextWordId""
                AND a.""TextId"" = b.""TextId""
                AND a.""WordId"" = b.""WordId"";
            ");

            migrationBuilder.DropIndex(
                name: "IX_TextWords_TextId",
                table: "TextWords");
                
            // 2. Clean up duplicate Words *before* creating the unique index
            // This is more complex because of FKs. We merge duplicates into the one with the smallest WordId.
            migrationBuilder.Sql(@"
                -- Create a temporary mapping of duplicate words to the canonical (min) WordId
                CREATE TEMP TABLE WordMappings AS
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

                -- Update TextWords to point to the canonical WordId
                -- Note: This might create new duplicates in TextWords if both old and new WordId were linked to the same Text.
                -- We'll process those potential TextWords duplicates again after this update.
                UPDATE ""TextWords""
                SET ""WordId"" = wm.NewId
                FROM WordMappings wm
                WHERE ""TextWords"".""WordId"" = wm.OldId;

                -- Update WordTranslations to point to the canonical WordId
                 UPDATE ""WordTranslations""
                SET ""WordId"" = wm.NewId
                FROM WordMappings wm
                WHERE ""WordTranslations"".""WordId"" = wm.OldId;

                -- Now delete the duplicate words
                DELETE FROM ""Words""
                USING WordMappings wm
                WHERE ""Words"".""WordId"" = wm.OldId;

                -- Clean up any *newly created* duplicate TextWords from the merge above
                DELETE FROM ""TextWords"" a
                USING ""TextWords"" b
                WHERE a.""TextWordId"" > b.""TextWordId""
                AND a.""TextId"" = b.""TextId""
                AND a.""WordId"" = b.""WordId"";

                DROP TABLE WordMappings;
            ");

            // 3. Add IsFinished column safely if it doesn't exist
            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Texts' AND column_name='IsFinished') THEN
                        ALTER TABLE ""Texts"" ADD COLUMN ""IsFinished"" boolean NOT NULL DEFAULT FALSE;
                    END IF;
                END
                $$;
            ");

            // 4. Create unique indexes safely if they don't exist
            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'IX_Words_UserId_Language_Term_Unique' AND n.nspname = 'public') THEN
                        -- Use a slightly different name if needed to avoid conflict with EF's default names if they exist but aren't unique
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
