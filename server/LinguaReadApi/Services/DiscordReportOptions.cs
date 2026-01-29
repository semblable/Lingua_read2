namespace LinguaReadApi.Services
{
    public class DiscordReportOptions
    {
        public bool WeeklyReportEnabled { get; set; } = false;
        public string WeeklyReportDayOfWeek { get; set; } = "Monday";
        public int WeeklyReportHourUtc { get; set; } = 8;
        public bool DryRun { get; set; } = false;
        public int PollIntervalMinutes { get; set; } = 30;
    }
}
