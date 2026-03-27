using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace LinguaReadApi.Migrations
{
    /// <inheritdoc />
    public partial class AddFolderOrganization : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "FolderId",
                table: "Texts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                table: "Texts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "FolderId",
                table: "Books",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                table: "Books",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "Folders",
                columns: table => new
                {
                    FolderId = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ParentFolderId = table.Column<int>(type: "integer", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    Color = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LanguageId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Folders", x => x.FolderId);
                    table.ForeignKey(
                        name: "FK_Folders_Folders_ParentFolderId",
                        column: x => x.ParentFolderId,
                        principalTable: "Folders",
                        principalColumn: "FolderId",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Folders_Languages_LanguageId",
                        column: x => x.LanguageId,
                        principalTable: "Languages",
                        principalColumn: "LanguageId",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Folders_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Texts_FolderId",
                table: "Texts",
                column: "FolderId");

            migrationBuilder.CreateIndex(
                name: "IX_Books_FolderId",
                table: "Books",
                column: "FolderId");

            migrationBuilder.CreateIndex(
                name: "IX_Folders_LanguageId",
                table: "Folders",
                column: "LanguageId");

            migrationBuilder.CreateIndex(
                name: "IX_Folders_ParentFolderId",
                table: "Folders",
                column: "ParentFolderId");

            migrationBuilder.CreateIndex(
                name: "IX_Folders_UserId_ParentFolderId",
                table: "Folders",
                columns: new[] { "UserId", "ParentFolderId" });

            migrationBuilder.AddForeignKey(
                name: "FK_Books_Folders_FolderId",
                table: "Books",
                column: "FolderId",
                principalTable: "Folders",
                principalColumn: "FolderId",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Texts_Folders_FolderId",
                table: "Texts",
                column: "FolderId",
                principalTable: "Folders",
                principalColumn: "FolderId",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Books_Folders_FolderId",
                table: "Books");

            migrationBuilder.DropForeignKey(
                name: "FK_Texts_Folders_FolderId",
                table: "Texts");

            migrationBuilder.DropTable(
                name: "Folders");

            migrationBuilder.DropIndex(
                name: "IX_Texts_FolderId",
                table: "Texts");

            migrationBuilder.DropIndex(
                name: "IX_Books_FolderId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "FolderId",
                table: "Texts");

            migrationBuilder.DropColumn(
                name: "SortOrder",
                table: "Texts");

            migrationBuilder.DropColumn(
                name: "FolderId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "SortOrder",
                table: "Books");
        }
    }
}
