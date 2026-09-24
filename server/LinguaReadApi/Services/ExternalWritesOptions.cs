namespace LinguaReadApi.Services
{
    /// <summary>
    /// Turns off everything that changes state in an outside account on the user's behalf:
    /// Hardcover reading status/progress/ratings and Discord report posts. Staging sets it
    /// (<c>ExternalWrites__Disabled=true</c>, written by _deploy.yml) because it runs on a nightly
    /// copy of production's data and must never touch the real accounts. Reads are unaffected
    /// (Hardcover search, matching and metadata import only update the local database), and so
    /// are translation lookups.
    /// </summary>
    public class ExternalWritesOptions
    {
        public const string SectionName = "ExternalWrites";

        public const string DisabledMessage =
            "Disabled on this server: it doesn't write to outside services (staging).";

        public bool Disabled { get; set; }
    }
}
