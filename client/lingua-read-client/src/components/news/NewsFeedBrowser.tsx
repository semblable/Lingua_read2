import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Alert, Spinner, Badge, Form, ButtonGroup } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { getNewsFeedEntries, importNewsFeedEntries } from '../../utils/api';
import type { NewsEntryOutcome, NewsFeedEntry, NewsFeedFetchResult } from '../../utils/api';
import { foldForSearch } from '../../utils/searchText';
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
// What's listed: the articles that can still be imported, the imported ones, or all.
type Filter = 'available' | 'imported' | 'all';

const isImported = (entry: NewsFeedEntry, outcome: NewsEntryOutcome | undefined) =>
  entry.status === 'imported' || outcome?.status === 'imported';

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
  // Null until the user picks one: "To import", or all when nothing is left to import.
  const [filter, setFilter] = useState<Filter | null>(null);
  const [query, setQuery] = useState('');
  // What the imports since the dialog opened made of each pick. A just-imported article stays in
  // the "To import" list with a way to open it, and one that couldn't be loaded says so.
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, NewsEntryOutcome>>>({});

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

  const counts = useMemo(() => {
    const imported = entries?.filter(e => e.status === 'imported').length ?? 0;
    return { available: (entries?.length ?? 0) - imported, imported, all: entries?.length ?? 0 };
  }, [entries]);

  const shownFilter: Filter = filter ?? (entries && counts.available === 0 ? 'all' : 'available');

  const shown = useMemo(() => {
    if (!entries) return [];
    const needle = foldForSearch(query.trim());
    return entries.filter(entry => {
      const outcome = outcomes[entry.key];
      if (shownFilter === 'available' && entry.status === 'imported' && !outcome) return false;
      if (shownFilter === 'imported' && entry.status !== 'imported') return false;
      return !needle || foldForSearch(`${entry.title} ${entry.summary ?? ''}`).includes(needle);
    });
  }, [entries, outcomes, shownFilter, query]);

  const pickable = shown.filter(entry => !isImported(entry, outcomes[entry.key]));
  const canSelectMore = !importing && !atCap && pickable.some(entry => !selected.has(entry.key));

  const hide = () => {
    // The next opening starts fresh: reloaded, nothing picked.
    setSelected(new Set());
    setMessage(null);
    setOutcomes({});
    setQuery('');
    setFilter(null);
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

  // Picks the listed articles from the top, as many as fit.
  const selectShown = () =>
    setSelected(current => {
      const next = new Set(current);
      for (const entry of pickable) {
        if (next.size >= MAX_PICKS) break;
        next.add(entry.key);
      }
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
        const byKey = Object.fromEntries((result.entries ?? []).map(outcome => [outcome.key, outcome]));
        setOutcomes(prev => ({ ...prev, ...byKey }));
        // The list stays as it is, even when nothing is left to import.
        setFilter(shownFilter);
        // One that couldn't be loaded stays picked, ready to try again.
        setSelected(new Set((result.entries ?? []).filter(o => o.status === 'unreachable').map(o => o.key)));
        setReloadKey(k => k + 1);
        onImported?.(result);
      }
    } catch (e) {
      setMessage({ variant: 'danger', text: errorText(e, 'The import failed.') });
    } finally {
      setImporting(false);
    }
  };

  const filterButton = (value: Filter, label: string, count: number) => (
    <Button
      variant={shownFilter === value ? 'primary' : 'outline-secondary'}
      size="sm"
      className={shownFilter === value ? undefined : 'news-browser-filter'}
      onClick={() => setFilter(value)}
      aria-pressed={shownFilter === value}
    >
      {label} <span className="opacity-75">{count}</span>
    </Button>
  );

  return (
    <Modal show={feedId != null} onHide={hide} size="lg" scrollable centered>
      <Modal.Header closeButton>
        <Modal.Title as="h5" style={{ overflowWrap: 'anywhere' }}>
          {feedTitle ? `Articles in ${feedTitle}` : 'Articles'}
        </Modal.Title>
      </Modal.Header>
      {entries && entries.length > 0 && (
        <div className="news-browser-toolbar border-bottom px-3 py-2">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <ButtonGroup aria-label="Show">
              {filterButton('available', 'To import', counts.available)}
              {filterButton('imported', 'Imported', counts.imported)}
              {filterButton('all', 'All', counts.all)}
            </ButtonGroup>
            <Form.Control
              type="text"
              size="sm"
              className="news-browser-search"
              placeholder="Search titles"
              aria-label="Search the articles"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>
      )}
      <Modal.Body className="pt-2">
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
        {entries && entries.length > 0 && shown.length === 0 && (
          <p className="text-muted small my-2">
            {query.trim()
              ? `No articles match "${query.trim()}".`
              : shownFilter === 'imported' ? 'Nothing from this feed is imported yet.' : 'Everything in the feed is imported already.'}
          </p>
        )}
        {shown.length > 0 && (
          <ul className="list-unstyled mb-0" aria-label="Articles in the feed">
            {shown.map(entry => {
              const id = `news-entry-${entry.key}`;
              const outcome = outcomes[entry.key];
              const imported = isImported(entry, outcome);
              const textId = outcome?.textId ?? entry.textId;
              const checked = selected.has(entry.key);
              const when = ago(entry.publishedAt);
              const details = (
                <>
                  <span className="d-block fw-semibold news-entry-title">{entry.title}</span>
                  <span className="small text-muted d-flex flex-wrap align-items-center column-gap-2 row-gap-1 mt-1">
                    {when && <span>{when}</span>}
                    {entry.wordCount != null && <span>~{entry.wordCount.toLocaleString()} words</span>}
                    {imported && <Badge bg="success">Imported</Badge>}
                    {!imported && outcome?.status === 'unreachable' && (
                      <Badge bg="warning" text="dark" title="The page couldn't be loaded just now. It's still picked: import it again in a while.">
                        Couldn't load, try again
                      </Badge>
                    )}
                    {!imported && outcome?.status === 'skipped' && (
                      <Badge bg="secondary">Too short or unreadable</Badge>
                    )}
                    {!imported && !outcome && entry.status === 'skipped' && (
                      <Badge bg="secondary" title="Too short or couldn't be read when it was tried. Pick it to try again.">Skipped before</Badge>
                    )}
                    {entry.link && (
                      <a href={entry.link} target="_blank" rel="noopener noreferrer" aria-label={`Original: ${entry.title}`}>
                        Original <i className="bi bi-box-arrow-up-right" aria-hidden="true"></i>
                      </a>
                    )}
                  </span>
                  {entry.summary && <span className="small text-muted news-entry-summary mt-1">{entry.summary}</span>}
                </>
              );
              return (
                <li
                  key={entry.key}
                  className={`news-entry d-flex align-items-start gap-2 py-2 px-2 ${checked ? 'news-entry-selected' : ''}`}
                  style={{ textAlign: 'left' }}
                >
                  {imported ? (
                    <>
                      <i className="bi bi-check2-circle text-success news-entry-mark" aria-hidden="true"></i>
                      <div className="flex-grow-1" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{details}</div>
                      {textId != null && (
                        <Link to={`/texts/${textId}`} className="btn btn-outline-primary btn-sm flex-shrink-0" onClick={hide}>Open</Link>
                      )}
                    </>
                  ) : (
                    <>
                      <Form.Check
                        id={id}
                        className="news-entry-mark"
                        checked={checked}
                        disabled={importing || (atCap && !checked)}
                        onChange={() => toggle(entry.key)}
                        aria-label={`Select ${entry.title}`}
                      />
                      {/* The whole row is the checkbox's label: a click anywhere but a link picks it. */}
                      <label htmlFor={id} className="flex-grow-1 news-entry-pick" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        {details}
                      </label>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-content-between flex-nowrap gap-2">
        <div className="small text-muted d-flex flex-wrap align-items-center column-gap-2" style={{ minWidth: 0 }}>
          {importing ? (
            <span className="d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" role="status" />
              <span>Downloading {selected.size === 1 ? 'the article' : `${selected.size} articles`}, this can take a minute...</span>
            </span>
          ) : (
            <>
              <span>{selected.size} selected{atCap && ` (up to ${MAX_PICKS} at a time)`}</span>
              {canSelectMore && (
                <Button variant="link" size="sm" className="p-0 news-browser-link" onClick={selectShown}>
                  {pickable.length <= MAX_PICKS ? 'Select all' : `Select first ${MAX_PICKS}`}
                </Button>
              )}
              {selected.size > 0 && (
                <Button variant="link" size="sm" className="p-0 news-browser-link" onClick={() => setSelected(new Set())}>Clear</Button>
              )}
            </>
          )}
        </div>
        <div className="d-flex gap-2 flex-shrink-0">
          <Button variant="secondary" onClick={hide}>Close</Button>
          <Button variant="primary" onClick={() => void importSelected()} disabled={importing || selected.size === 0}>
            {importing ? 'Importing...' : selected.size > 0 ? `Import ${selected.size}` : 'Import'}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default NewsFeedBrowser;
