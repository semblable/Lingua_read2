using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using System.Threading.Channels;

namespace LinguaReadApi.Services;

public sealed record HardcoverSyncRequest(Guid UserId, int BookId, decimal? Rating = null);

public sealed class HardcoverOperationLock
{
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _locks = new();

    public async Task<IDisposable> AcquireAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var semaphore = _locks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
        await semaphore.WaitAsync(cancellationToken);
        return new Releaser(semaphore);
    }

    private sealed class Releaser : IDisposable
    {
        private SemaphoreSlim? _semaphore;

        public Releaser(SemaphoreSlim semaphore) => _semaphore = semaphore;

        public void Dispose()
        {
            Interlocked.Exchange(ref _semaphore, null)?.Release();
        }
    }
}

public sealed class HardcoverSyncChannel
{
    public const int DefaultCapacity = 2048;

    private readonly object _sync = new();
    private readonly int _capacity;
    private readonly Dictionary<(Guid UserId, int BookId), HardcoverSyncRequest> _pending = new();
    private readonly Channel<(Guid UserId, int BookId)> _keys =
        Channel.CreateUnbounded<(Guid UserId, int BookId)>(new UnboundedChannelOptions
        {
            SingleReader = false,
            SingleWriter = false
        });
    private bool _completed;

    public HardcoverSyncChannel(int capacity = DefaultCapacity)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(capacity, 0);
        _capacity = capacity;
        Reader = new CoalescingChannelReader(this);
    }

    public ChannelReader<HardcoverSyncRequest> Reader { get; }

    internal int PendingCount
    {
        get
        {
            lock (_sync)
            {
                return _pending.Count;
            }
        }
    }

    public bool TryEnqueue(HardcoverSyncRequest request)
    {
        lock (_sync)
        {
            if (_completed)
            {
                return false;
            }

            var key = (request.UserId, request.BookId);
            if (_pending.TryGetValue(key, out var existing))
            {
                var mergedRating = request.Rating ?? existing.Rating;
                _pending[key] = existing with { Rating = mergedRating };
                return true;
            }

            if (_pending.Count >= _capacity)
            {
                return false;
            }

            _pending[key] = request;
            _keys.Writer.TryWrite(key);
            return true;
        }
    }

    public bool TryDequeue(out HardcoverSyncRequest? request)
    {
        lock (_sync)
        {
            while (_keys.Reader.TryRead(out var key))
            {
                if (_pending.Remove(key, out var item))
                {
                    request = item;
                    return true;
                }
            }

            request = null;
            return false;
        }
    }

    public void Complete()
    {
        lock (_sync)
        {
            if (_completed)
            {
                return;
            }

            _completed = true;
            _keys.Writer.TryComplete();
        }
    }

    private sealed class CoalescingChannelReader : ChannelReader<HardcoverSyncRequest>
    {
        private readonly HardcoverSyncChannel _owner;

        public CoalescingChannelReader(HardcoverSyncChannel owner) => _owner = owner;

        public override Task Completion => _owner._keys.Reader.Completion;

        public override bool CanCount => true;

        public override int Count => _owner.PendingCount;

        public override bool TryRead([MaybeNullWhen(false)] out HardcoverSyncRequest item)
        {
            if (_owner.TryDequeue(out var dequeued) && dequeued != null)
            {
                item = dequeued;
                return true;
            }

            item = null;
            return false;
        }

        public override ValueTask<bool> WaitToReadAsync(CancellationToken cancellationToken = default) =>
            _owner._keys.Reader.WaitToReadAsync(cancellationToken);
    }
}
