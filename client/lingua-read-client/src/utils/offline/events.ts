export type OfflineEvent = 'auth-required' | 'auth-restored' | 'sync-complete';
const channelName = 'lingua-read:offline-events';
const eventName = (type: OfflineEvent) => `${channelName}:${type}`;
const openChannel = (): BroadcastChannel | null => {
  try { return typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel(channelName) : null; }
  catch { return null; }
};

// Broadcast only lifecycle notifications; vocabulary and credentials stay out
// of cross-tab messages. Each reader fetches identities under its own session.
export function notifyOfflineEvent(type: OfflineEvent): void {
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
  if (channel) channel.onmessage = event => { if (event.data === type) listener(); };
  return () => {
    window.removeEventListener(eventName(type), handler);
    channel?.close();
  };
}
