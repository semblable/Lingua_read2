export type OfflineEvent = 'auth-required' | 'auth-restored' | 'sync-complete' | 'session-ended';
let sessionRevision = 0;
export const offlineSessionRevision = (): number => sessionRevision;
const channelName = 'lingua-read:offline-events';
const eventName = (type: OfflineEvent) => `${channelName}:${type}`;
const openChannel = (): BroadcastChannel | null => {
  try { return typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel(channelName) : null; }
  catch { return null; }
};

// Broadcast only lifecycle notifications; vocabulary and credentials stay out
// of cross-tab messages. Each reader fetches identities under its own session.
export function notifyOfflineEvent(type: OfflineEvent): void {
  if (type === 'session-ended') sessionRevision++;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(eventName(type)));
  const channel = openChannel();
  try { channel?.postMessage(type); } catch { /* Local notifications still work. */ }
  finally { channel?.close(); }
}

export function subscribeOfflineEvent(type: OfflineEvent, listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener();
  window.addEventListener(eventName(type), handler);
  const channel = openChannel();
  if (channel) channel.onmessage = event => {
    if (event.data === type) {
      if (type === 'session-ended') sessionRevision++;
      listener();
    }
  };
  return () => {
    window.removeEventListener(eventName(type), handler);
    channel?.close();
  };
}

// Per-word replay results stay in this tab. Cross-tab lifecycle events above
// deliberately carry no vocabulary; other readers reconcile through their API.
export type WordReplayResult = {
  op: Extract<import('./syncQueue').StoredPendingOp, { type: 'wordCreate' | 'wordStatusUpdate' }>;
  outcome: 'confirmed' | 'rejected' | 'retryable';
  result?: unknown;
};
const wordReplayListeners = new Set<(event: WordReplayResult) => void>();
export function notifyWordReplay(event: WordReplayResult): void {
  wordReplayListeners.forEach(listener => {
    try { listener(event); } catch { /* UI observers cannot turn a replay success into a retry. */ }
  });
}
export function subscribeWordReplay(listener: (event: WordReplayResult) => void): () => void {
  wordReplayListeners.add(listener);
  return () => { wordReplayListeners.delete(listener); };
}
