using Microsoft.EntityFrameworkCore.Migrations;

namespace LinguaReadApi.Data.Migrations;

public partial class UniqueGoalPeriods : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Preserve the most recently computed copy of each historical period.
        migrationBuilder.Sql("""
            DELETE FROM "UserGoalPeriods" WHERE "PeriodId" IN (
                SELECT "PeriodId" FROM (
                    SELECT "PeriodId", ROW_NUMBER() OVER (
                        PARTITION BY "GoalId", "PeriodEnd"
                        ORDER BY "ClosedAt" DESC, "PeriodId" DESC
                    ) AS duplicate_rank FROM "UserGoalPeriods"
                ) AS duplicates WHERE duplicate_rank > 1
            );
            """);
        migrationBuilder.DropIndex("IX_UserGoalPeriods_GoalId_PeriodEnd", "UserGoalPeriods");
        migrationBuilder.CreateIndex("IX_UserGoalPeriods_GoalId_PeriodEnd", "UserGoalPeriods",
            new[] { "GoalId", "PeriodEnd" }, unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex("IX_UserGoalPeriods_GoalId_PeriodEnd", "UserGoalPeriods");
        migrationBuilder.CreateIndex("IX_UserGoalPeriods_GoalId_PeriodEnd", "UserGoalPeriods", new[] { "GoalId", "PeriodEnd" });
    }
}
