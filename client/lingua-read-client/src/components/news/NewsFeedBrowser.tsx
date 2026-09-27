import React, { useEffect, useState } from 'react';
import { Modal, Button, Alert, Spinner, Badge, Form } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { getNewsFeedEntries, importNewsFeedEntries } from '../../utils/api';
import type { NewsFeedEntry, NewsFeedFetchResult } from '../../utils/api';
import { ago, errorText } from './newsFormat';

interface NewsFeedBrowserProps {
  // The feed whose articles are shown; null keeps the dialog closed.
  feedId: number | null;
  feedTitle?: string;
  onHide: () => void;
  // After an import, with its result (the feed's updated row among it).
  onImported?: (result: NewsFeedFetchResult) => void;
}

// Picked entries imported in one go at most (the server's NewsFeedImporter.MaxSelectedEntries).
export const MAX_PICKS = 20;

type Loaded = { feedId: number; key: string; entries: NewsFeedEntry[] | null; error: string | null };
type Message = { variant: 'success' | 'warning' | 'danger'; text: string };

/**
 * A feed's current articles, to pick which to import (Settings › News feeds, and a news feed's
 * folder in the Library). Picks are imported at once, whatever the daily limit.
 */
const NewsFeedBrowser = ({ feedId, feedTitle, onHide, onImported }: NewsFeedBrowserProps) => {
  // Loads are keyed by feed and a counter: a newer answer (or another feed's) replaces an older one.
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = feedId == null ? null : `${feedId}:${reloadKey}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    if (feedId == null) return;
    let cancelled = false;
    const key = `${feedId}:${reloadKey}`;
    getNewsFeedEntries(feedId)
      .then(result => { if (!cancelled) setLoaded({ feedId, key, entries: result.entries, error: null }); })
      .catch(e => {
        if (cancelled) return;
        // A failed reload keeps the list it had.
        setLoaded(prev => ({
          feedId,
          key,
          entries: prev?.feedId === feedId ? prev.entries : null,
          error: errorText(e, "Couldn't load the feed's articles.")
        }));
      });
    return () => { cancelled = true; };
  }, [feedId, reloadKey]);

  const current = loaded && loaded.feedId === feedId ? loaded : null;
  const entries = current?.entries ?? null;
  const loading = current?.key !== requestKey;
  const loadError = loading ? null : current?.error ?? null;
  const atCap = selected.size >= MAX_PICKS;

  const hide = () => {
    // The next opening starts fresh: reloaded, nothing picked.
    setSelected(new Set());
    setMessage(null);
    setReloadKey(k => k + 1);
    onHide();
  };

  const toggle = (key: string) =>
    setSelected(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_PICKS) next.add(key);
      return next;
    });

  const importSelected = async () => {
    if (feedId == null || selected.size === 0 || importing) return;
    setImporting(true);
    setMessage(null);
    try {
      const result = await importNewsFeedEntries(feedId, [...selected]);
      setMessage({
        variant: !result.success ? 'danger' : result.imported > 0 ? 'success' : 'warning',
        text: result.message
      });
      if (result.success) {
        setSelected(new Set());
        setReloadKey(k => k + 1);
        onImported?.(result);
      }
    } catch (e) {
      setMessage({ variant: 'danger', text: errorText(e, 'The import failed.') });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal show={feedId != null} onHide={hide} size="lg" scrollable centered>
      <Modal.Header closeButton>
        <Modal.Title as="h5" style={{ overflowWrap: 'anywhere' }}>
          {feedTitle ? `Articles in ${feedTitle}` : 'Articles'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {message && <Alert variant={message.variant} className="py-2">{message.text}</Alert>}
        {loading && (
          <div className="d-flex align-items-center gap-2 text-muted small mb-2">
            <Spinner animation="border" size="sm" role="status" />
            <span>Loading the feed...</span>
          </div>
        )}
        {loadError && (
          <Alert variant="danger" className="py-2">
            {loadError}{' '}
            <Button variant="link" size="sm" className="p-0 align-baseline" onClick={() => setReloadKey(k => k + 1)}>Try again</Button>
          </Alert>
        )}
        {entries && entries.length === 0 && !loading && (
          <p className="text-muted small mb-0">The feed has no articles right now.</p>
        )}
        {entries && entries.length > 0 && (
          <ul className="list-unstyled mb-0" aria-label="Articles in the feed">
            {entries.map((entry, index) => {
              const id = `news-entry-${index}`;
              const checked = selected.has(entry.key);
              const when = ago(entry.publishedAt);
              return (
                <li key={entry.key} className="d-flex align-items-start gap-2 py-2 border-bottom" style={{ textAlign: 'left' }}>
                  {entry.status === 'imported' ? (
                    <i className="bi bi-check2-circle text-success mt-1" aria-hidden="true" style={{ width: '1em' }}></i>
                  ) : (
                    <Form.Check
                      id={id}
                      className="mt-1"
                      checked={checked}
                      disabled={importing || (atCap && !checked)}
                      onChange={() => toggle(entry.key)}
                      aria-label={`Select ${entry.title}`}
                    />
                  )}
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    {entry.status === 'imported' ? (
                      <strong style={{ overflowWrap: 'anywhere' }}>{entry.title}</strong>
                    ) : (
                      <label htmlFor={id} className="fw-semibold" style={{ cursor: 'pointer', overflowWrap: 'anywhere' }}>{entry.title}</label>
                    )}
                    <div className="small text-muted d-flex flex-wrap align-items-center gap-2">
                      {when && <span>{when}</span>}
                      {entry.status === 'imported' && <Badge bg="success">Imported</Badge>}
                      {entry.status === 'skipped' && (
                        <Badge bg="secondary" title="Too short or couldn't be read when it was tried. Pick it to try again.">Skipped before</Badge>
                      )}
                      {entry.link && (
                        <a href={entry.link} target="_blank" rel="noopener noreferrer">Original</a>
                      )}
                    </div>
                    {entry.summary && <div className="small text-muted news-entry-summary">{entry.summary}</div>}
                  </div>
                  {entry.status === 'imported' && entry.textId != null && (
                    <Link to={`/texts/${entry.textId}`} className="btn btn-outline-primary btn-sm" onClick={hide}>Open</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-content-between">
        <small className="text-muted">
          {selected.size} selected{atCap && ` (up to ${MAX_PICKS} at a time)`}
        </small>
        <div className="d-flex gap-2">
          <Button variant="secondary" onClick={hide}>Close</Button>
          <Button variant="primary" onClick={() => void importSelected()} disabled={importing || selected.size === 0}>
            {importing ? 'Importing...' : selected.size > 0 ? `Import ${selected.size} selected` : 'Import selected'}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default NewsFeedBrowser;
