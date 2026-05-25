import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ProgressBar, Spinner } from 'react-bootstrap';

interface DownloadForOfflineButtonProps {
  /** Cache name to store the assets under. */
  cacheName: string;
  /** URLs to pre-fetch and cache (text content + audio tracks for a lesson). */
  urls: string[];
  /** Label for the button. */
  label?: string;
  /**
   * Total-bytes threshold above which the user gets a "this is X MB, continue?"
   * confirmation before download starts. Defaults to 100 MB on regular
   * connections; we drop to 50 MB when navigator.connection reports cellular
   * or data-saver mode (see effectiveThreshold()).
   */
  sizeWarningBytes?: number;
}

type State =
  | 'idle'
  | 'sizing'           // HEAD requests in flight to compute total
  | 'awaiting-confirm' // Total exceeds threshold — waiting for user OK
  | 'in-flight'        // Actively downloading
  | 'cached'           // Everything already in the cache
  | 'unavailable'      // Cache Storage API missing (Safari private mode)
  | 'error';

const DEFAULT_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB
const METERED_THRESHOLD_BYTES = 50 * 1024 * 1024;  // 50 MB

function isMeteredConnection(): boolean {
  // navigator.connection is non-standard; only Chrome/Edge surface it reliably.
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string; type?: string };
  }).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  if (conn.type === 'cellular') return true;
  if (conn.effectiveType === '2g' || conn.effectiveType === '3g') return true;
  return false;
}

function effectiveThreshold(override?: number): number {
  if (typeof override === 'number') return override;
  return isMeteredConnection() ? METERED_THRESHOLD_BYTES : DEFAULT_THRESHOLD_BYTES;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface SizeMap {
  total: Map<string, number>;
  received: Map<string, number>;
}

const DownloadForOfflineButton: React.FC<DownloadForOfflineButtonProps> = ({
  cacheName,
  urls,
  label = 'Download for offline',
  sizeWarningBytes,
}) => {
  const [state, setState] = useState<State>('idle');
  const [sizes, setSizes] = useState<SizeMap>({ total: new Map(), received: new Map() });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Detect whether the Cache Storage API is even available.
  useEffect(() => {
    if (typeof caches === 'undefined') setState('unavailable');
  }, []);

  // On mount, check whether everything is already cached so we can show a
  // "Cached" badge instead of the download CTA.
  useEffect(() => {
    if (state !== 'idle' || urls.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        if (typeof caches === 'undefined') return;
        const cache = await caches.open(cacheName);
        const results = await Promise.all(urls.map((u) => cache.match(u)));
        if (!cancelled && results.every((r) => r != null)) setState('cached');
      } catch {
        // Best-effort — stay idle.
      }
    })();
    return () => { cancelled = true; };
  }, [cacheName, urls, state]);

  const beginDownload = useCallback(async (totals: Map<string, number>) => {
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    setState('in-flight');
    setSizes({ total: new Map(totals), received: new Map(urls.map((u) => [u, 0])) });
    setErrorMessage(null);

    // Track per-session puts so we can roll them back if the download is
    // aborted or fails partway through. Without this, a 5-URL book cancelled
    // after URL #2 would leave URLs #1 and #2 in the cache, and the mount-
    // time check would mistakenly report the book as "Available offline".
    //
    // Only track URLs that were NOT already in the cache before this run.
    // cache.put() overwrites, and the same cacheName is shared across all
    // DownloadForOfflineButton instances (lr-audio for BookDetail + TextDisplay)
    // — rolling back an entry that an earlier successful download owned would
    // silently un-cache that other lesson's asset.
    const cachedThisSession: string[] = [];
    let cache: Cache | undefined;

    try {
      cache = await caches.open(cacheName);
      for (const url of urls) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const response = await fetch(url, { credentials: 'include', signal });
        if (!response.ok) throw new Error(`${url} responded ${response.status}`);

        // Stream body chunks so the progress bar moves smoothly within a file
        // and memory pressure is bounded (we still need to assemble a Blob for
        // cache.put, but at least the user sees real-time feedback and we
        // never hold two copies in memory).
        const total = Number(response.headers.get('Content-Length')) ||
                      totals.get(url) || 0;
        const body = response.body;
        let blob: Blob;

        if (!body) {
          // Some test fakes don't expose body — fall back to the simple path.
          blob = await response.blob();
          setSizes((prev) => {
            const next = new Map(prev.received);
            next.set(url, blob.size);
            return { total: prev.total, received: next };
          });
        } else {
          const reader = body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          while (true) {
            if (signal.aborted) {
              try { await reader.cancel(); } catch { /* ignore */ }
              throw new DOMException('Cancelled', 'AbortError');
            }
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.byteLength;
              setSizes((prev) => {
                const next = new Map(prev.received);
                next.set(url, received);
                // If Content-Length was missing, surface the partial total so
                // the progress bar at least shows monotonic growth.
                const totalsNext = prev.total.get(url)
                  ? prev.total
                  : new Map(prev.total).set(url, Math.max(received, total));
                return { total: totalsNext, received: next };
              });
            }
          }
          // The chunk type from response.body.getReader() is
          // Uint8Array<ArrayBufferLike>, which strict TS won't pass directly
          // as BlobPart[] (the union excludes SharedArrayBuffer-backed views).
          // Cast is safe in practice — fetch always returns ArrayBuffer-backed
          // Uint8Arrays, never SharedArrayBuffer ones.
          blob = new Blob(chunks as BlobPart[]);
        }

        // Reconstruct a Response with headers preserved so the
        // RangeRequestsPlugin can serve seek requests against the cached body.
        const headers = new Headers(response.headers);
        if (!headers.has('Accept-Ranges')) headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Length', String(blob.size));
        const cacheable = new Response(blob, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
        const preExisting = await cache.match(url);
        await cache.put(url, cacheable);
        if (!preExisting) cachedThisSession.push(url);
      }
      setState('cached');
    } catch (err) {
      // Roll back any entries we put in the cache during this aborted/failed
      // run so the next mount doesn't see a partial set as "Available offline".
      if (cache && cachedThisSession.length > 0) {
        const c = cache;
        await Promise.all(
          cachedThisSession.map((u) => c.delete(u).catch(() => undefined))
        );
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        setState('idle');
        setSizes({ total: new Map(), received: new Map() });
        return;
      }
      setState('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      abortRef.current = null;
    }
  }, [cacheName, urls]);

  const handleClick = useCallback(async () => {
    if (urls.length === 0) return;
    setState('sizing');
    setErrorMessage(null);
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    // HEAD each URL in parallel to learn the byte total. Failed HEADs (server
    // doesn't allow them, or network glitch) get 0 — they just won't be
    // counted against the threshold; the actual GET still happens later.
    const totalsArr = await Promise.all(urls.map(async (url) => {
      try {
        const r = await fetch(url, { method: 'HEAD', credentials: 'include', signal });
        if (!r.ok) return [url, 0] as const;
        return [url, Number(r.headers.get('Content-Length')) || 0] as const;
      } catch {
        return [url, 0] as const;
      }
    }));
    abortRef.current = null;

    const totals = new Map<string, number>(totalsArr);
    const totalBytes = totalsArr.reduce((acc, [, n]) => acc + n, 0);
    const threshold = effectiveThreshold(sizeWarningBytes);

    if (totalBytes > 0 && totalBytes > threshold) {
      setSizes({ total: totals, received: new Map() });
      setState('awaiting-confirm');
      return;
    }

    await beginDownload(totals);
  }, [urls, beginDownload, sizeWarningBytes]);

  const handleConfirm = useCallback(() => {
    void beginDownload(sizes.total);
  }, [beginDownload, sizes.total]);

  const handleCancel = useCallback(() => {
    setSizes({ total: new Map(), received: new Map() });
    setState('idle');
  }, []);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  if (state === 'unavailable') return null;

  if (state === 'cached') {
    return (
      <Button
        variant="outline-success"
        size="sm"
        disabled
        data-testid="download-offline-button"
        data-download-state="cached"
      >
        <i className="bi bi-check-circle me-1" /> Available offline
      </Button>
    );
  }

  if (state === 'sizing') {
    return (
      <span className="d-inline-flex align-items-center gap-2" data-testid="download-offline-sizing">
        <Spinner animation="border" size="sm" />
        <small className="text-muted">Checking download size…</small>
      </span>
    );
  }

  if (state === 'awaiting-confirm') {
    const totalBytes = Array.from(sizes.total.values()).reduce((a, b) => a + b, 0);
    return (
      <div className="d-inline-flex align-items-center gap-2" data-testid="download-offline-confirm">
        <small>This will download <strong>{formatBytes(totalBytes)}</strong>.</small>
        <Button variant="primary" size="sm" onClick={handleConfirm} data-testid="download-offline-confirm-go">
          Download
        </Button>
        <Button variant="outline-secondary" size="sm" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  if (state === 'in-flight') {
    const total = Array.from(sizes.total.values()).reduce((a, b) => a + b, 0);
    const received = Array.from(sizes.received.values()).reduce((a, b) => a + b, 0);
    const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
    return (
      <div className="d-inline-flex align-items-center gap-2" data-testid="download-offline-progress">
        <div style={{ minWidth: 160 }}>
          <ProgressBar
            now={percent}
            label={total > 0 ? `${percent}%` : `${formatBytes(received)}`}
            data-testid="download-offline-progress-bar"
            data-percent={percent}
          />
        </div>
        <small className="text-muted" data-testid="download-offline-bytes">
          {formatBytes(received)}{total > 0 ? ` / ${formatBytes(total)}` : ''}
        </small>
        <Button variant="outline-danger" size="sm" onClick={handleAbort} data-testid="download-offline-abort">
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        variant="outline-primary"
        size="sm"
        onClick={handleClick}
        disabled={urls.length === 0}
        data-testid="download-offline-button"
        data-download-state={state}
      >
        <i className="bi bi-cloud-download me-1" /> {label}
      </Button>
      {state === 'error' && errorMessage && (
        <small className="text-danger ms-2" data-testid="download-offline-error">
          {errorMessage}
        </small>
      )}
    </>
  );
};

export default DownloadForOfflineButton;
