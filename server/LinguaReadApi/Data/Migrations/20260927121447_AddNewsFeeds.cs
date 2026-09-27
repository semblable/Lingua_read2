using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <summary>
    /// News feeds: the NewsFeeds and NewsFeedItems tables, Texts.NewsFeedId/SourceUrl for imported
    /// articles, and the three settings. Existing users start with import off, 3 articles per feed
    /// a day and unopened articles deleted after 14 days, the model's defaults.
    /// </summary>
    public partial class AddNewsFeeds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "NewsArticlesPerFeedPerDay",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 3);

            migrationBuilder.AddColumn<int>(
                name: "NewsDeleteUnreadAfterDays",
                table: "UserSettings",
                type: "integer",
                nullable: false,
                defaultValue: 14);

            migrationBuilder.AddColumn<bool>(
                name: "NewsImportEnabled",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "NewsFeedId",
                table: "Texts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceUrl",
                table: "Texts",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "NewsFeeds",
                columns: table => new
                {
                    NewsFeedId = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Url = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    LanguageId = table.Column<int>(type: "integer", nullable: false),
                    FolderId = table.Column<int>(type: "integer", nullable: true),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastCheckedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastSuccessAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ConsecutiveFailures = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsFeeds", x => x.NewsFeedId);
                    table.ForeignKey(
                        name: "FK_NewsFeeds_Folders_FolderId",
                        column: x => x.FolderId,
                        principalTable: "Folders",
                        principalColumn: "FolderId",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_NewsFeeds_Languages_LanguageId",
                        column: x => x.LanguageId,
                        principalTable: "Languages",
                        principalColumn: "LanguageId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NewsFeeds_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NewsFeedItems",
                columns: table => new
                {
                    NewsFeedItemId = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    NewsFeedId = table.Column<int>(type: "integer", nullable: false),
                    ItemKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Imported = table.Column<bool>(type: "boolean", nullable: false),
                    FirstSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsFeedItems", x => x.NewsFeedItemId);
                    table.ForeignKey(
                        name: "FK_NewsFeedItems_NewsFeeds_NewsFeedId",
                        column: x => x.NewsFeedId,
                        principalTable: "NewsFeeds",
                        principalColumn: "NewsFeedId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Texts_NewsFeedId",
                table: "Texts",
                column: "NewsFeedId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsFeedItems_NewsFeedId_ItemKey",
                table: "NewsFeedItems",
                columns: new[] { "NewsFeedId", "ItemKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NewsFeeds_FolderId",
                table: "NewsFeeds",
                column: "FolderId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsFeeds_LanguageId",
                table: "NewsFeeds",
                column: "LanguageId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsFeeds_UserId",
                table: "NewsFeeds",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Texts_NewsFeeds_NewsFeedId",
                table: "Texts",
                column: "NewsFeedId",
                principalTable: "NewsFeeds",
                principalColumn: "NewsFeedId",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Texts_NewsFeeds_NewsFeedId",
                table: "Texts");

            migrationBuilder.DropTable(
                name: "NewsFeedItems");

            migrationBuilder.DropTable(
                name: "NewsFeeds");

            migrationBuilder.DropIndex(
                name: "IX_Texts_NewsFeedId",
                table: "Texts");

            migrationBuilder.DropColumn(
                name: "NewsArticlesPerFeedPerDay",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "NewsDeleteUnreadAfterDays",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "NewsImportEnabled",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "NewsFeedId",
                table: "Texts");

            migrationBuilder.DropColumn(
                name: "SourceUrl",
                table: "Texts");
        }
    }
}
