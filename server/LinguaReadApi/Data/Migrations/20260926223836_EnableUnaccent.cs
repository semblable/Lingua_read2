using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <summary>
    /// Installs Postgres's unaccent extension (CREATE EXTENSION IF NOT EXISTS unaccent) for the
    /// accent- and case-insensitive search, which AppDbContext translates to
    /// <c>unaccent(lower(x))</c>. It ships with Postgres's contrib modules and is a trusted
    /// extension, so the database owner can create it without being superuser.
    /// </summary>
    public partial class EnableUnaccent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:unaccent", ",,");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .OldAnnotation("Npgsql:PostgresExtension:unaccent", ",,");
        }
    }
}
