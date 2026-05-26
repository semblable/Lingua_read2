using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LinguaReadApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAutoAdvanceAudiobookTracksSetting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AutoAdvanceAudiobookTracks",
                table: "UserSettings",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AutoAdvanceAudiobookTracks",
                table: "UserSettings");
        }
    }
}
