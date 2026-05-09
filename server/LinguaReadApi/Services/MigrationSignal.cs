namespace LinguaReadApi.Services
{
    /// <summary>
    /// Singleton coordination token. WordLinkingMigrationService calls
    /// SetComplete() when its startup relink + cleanup pass finishes.
    /// StatsRecomputeService awaits Completed before its startup sweep
    /// so it sees real OccurrenceCount values instead of the placeholder
    /// default-1 values written by the AddTextWordOccurrenceCount migration.
    /// </summary>
    public sealed class MigrationSignal
    {
        private readonly TaskCompletionSource _tcs =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task Completed => _tcs.Task;

        public void SetComplete() => _tcs.TrySetResult();
    }
}
