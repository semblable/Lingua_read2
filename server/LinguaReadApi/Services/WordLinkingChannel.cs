using System.Threading.Channels;

namespace LinguaReadApi.Services
{
    public record WordLinkingRequest(int TextId, string Content, int LanguageId, Guid UserId);

    public class WordLinkingChannel
    {
        // Unbounded because every writer is an HTTP request (book import,
        // re-split, audio lessons). With the old bound of 100 and
        // FullMode.Wait, a large import waited on the single worker and
        // held its request open until all but the last 100 parts were
        // linked (217 of 317 for one staging book). The worker drains one
        // request at a time either way; a queued book costs roughly its
        // own text in memory.
        private readonly Channel<WordLinkingRequest> _channel =
            Channel.CreateUnbounded<WordLinkingRequest>();

        public ChannelWriter<WordLinkingRequest> Writer => _channel.Writer;
        public ChannelReader<WordLinkingRequest> Reader => _channel.Reader;
    }
}
