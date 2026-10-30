import { API_URL } from './api/client';
import { CHINESE_DICTIONARY_SHA256 } from './chineseSegmenter';
import { initializeChineseSegmentation } from './chineseRuntime';

const CACHE = 'lr-chinese-dictionary-v1';
let loading: Promise<void> | null = null;

async function validatedText(response: Response): Promise<string> {
  if (!response.ok) throw new Error('Chinese dictionary could not be loaded. Reconnect and reopen this text.');
  const bytes = await response.arrayBuffer();
  if (!crypto.subtle) throw new Error('Chinese segmentation requires HTTPS or localhost to verify its dictionary.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== CHINESE_DICTIONARY_SHA256.toLowerCase()) throw new Error('Chinese dictionary version mismatch. Reconnect and reopen this text.');
  return new TextDecoder().decode(bytes);
}

/** One pinned public dictionary; never mix algorithm versions or silently fall back. */
export const ensureChineseSegmentation = (): Promise<void> => {
  if (loading) return loading;
  loading = (async () => {
    const url = `${API_URL}/segmentation/jieba-v1/dictionary`;
    let cache: Cache | null = null;
    try { if (typeof caches !== 'undefined') cache = await caches.open(CACHE); } catch { /* Online reading can work without storage. */ }
    let cached: Response | undefined;
    try { cached = await cache?.match(url); } catch { cache = null; }
    if (cached) {
      try { initializeChineseSegmentation(await validatedText(cached)); return; }
      catch { try { await cache?.delete(url); } catch { cache = null; } }
    }
    const response = await fetch(url, { credentials: 'include' });
    const dictionary = await validatedText(response.clone());
    initializeChineseSegmentation(dictionary);
    try { await cache?.put(url, response); } catch { /* Storage quota must not block online reading. */ }
  })().catch(error => { loading = null; throw error; });
  return loading;
};
