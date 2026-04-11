using System.Threading.Channels;

namespace LinguaReadApi.Services
{
    public record WordLinkingRequest(int TextId, string Content, int LanguageId, Guid UserId);

    public class WordLinkingChannel
    {
        private readonly Channel<WordLinkingRequest> _channel =
            Channel.CreateBounded<WordLinkingRequest>(new BoundedChannelOptions(100)
            {
                FullMode = BoundedChannelFullMode.Wait
            });

        public ChannelWriter<WordLinkingRequest> Writer => _channel.Writer;
        public ChannelReader<WordLinkingRequest> Reader => _channel.Reader;
    }
}
