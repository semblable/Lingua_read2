import React, { useCallback, useEffect, useState } from 'react';
import { Form, Button, Alert, Spinner, Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import type { Settings } from '../../contexts/SettingsContext';
import type { SettingsChangeHandler } from './AppearanceSettings';
import { addNewsFeed, deleteNewsFeed, fetchNewsFeed, getNewsFeeds, updateNewsFeed } from '../../utils/api';
import type { NewsFeed } from '../../utils/api';

type LanguageOption = { languageId: number; name: string };

interface NewsFeedSettingsProps {
  settings: Settings;
  handleChange: SettingsChangeHandler;
  languages: LanguageOption[];
}

type FeedMessage = { variant: 'success' | 'warning' | 'danger'; text: string };

const PER_DAY_OPTIONS = [1, 2, 3, 5, 10];
const DELETE_AFTER_OPTIONS = [
  { value: 0, label: 'Never' },
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' }
];

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;

// "5m ago", "2h ago", "3d ago".
const ago = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// A numeric setting that isn't one of the offered choices (set elsewhere) is still shown.
const withCurrent = (options: number[], current: number) =>
  options.includes(current) ? options : [...options, current].sort((a, b) => a - b);

const NewsFeedSettings = ({ settings, handleChange, languages }: NewsFeedSettingsProps) => {
  const enabled = settings.newsImportEnabled;
  const [feeds, setFeeds] = useState<NewsFeed[]>([]);
  const [loadError, setLoadError] = useState('');
  // Loads are numbered; the list is loading until the latest one has answered.
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedKey, setLoadedKey] = useState<number | null>(null);
  const loading = loadedKey !== reloadKey;

  const [url, setUrl] = useState('');
  const [chosenLanguageId, setChosenLanguageId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const [busyFeedId, setBusyFeedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Record<number, FeedMessage>>({});

  // The add form starts on the default language, else the first one.
  const languageId = chosenLanguageId
    ?? (languages.find(l => l.languageId === settings.defaultLanguageId) ?? languages[0])?.languageId
    ?? 0;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getNewsFeeds()
      .then(list => {
        if (cancelled) return;
        setFeeds(list);
        setLoadError('');
      })
      .catch(e => { if (!cancelled) setLoadError(errorText(e, 'Failed to load your feeds.')); })
      .finally(() => { if (!cancelled) setLoadedKey(reloadKey); });
    return () => { cancelled = true; };
  }, [enabled, reloadKey]);

  const retryLoad = () => {
    setLoadError('');
    setReloadKey(k => k + 1);
  };

  const replaceFeed = (feed: NewsFeed) =>
    setFeeds(list => list.map(f => (f.newsFeedId === feed.newsFeedId ? feed : f)));

  const setMessage = (feedId: number, message: FeedMessage | null) =>
    setMessages(current => {
      const next = { ...current };
      if (message) next[feedId] = message;
      else delete next[feedId];
      return next;
    });

  const fetchNow = useCallback(async (feedId: number) => {
    setBusyFeedId(feedId);
    setMessage(feedId, null);
    try {
      const result = await fetchNewsFeed(feedId);
      if (result.feed) replaceFeed(result.feed);
      setMessage(feedId, {
        variant: !result.success ? 'danger' : result.imported > 0 ? 'success' : 'warning',
        text: result.message ?? ''
      });
    } catch (e) {
      setMessage(feedId, { variant: 'danger', text: errorText(e, 'The check failed.') });
    } finally {
      setBusyFeedId(null);
    }
  }, []);

  const addFeed = async () => {
    if (!url.trim() || adding) return;
    setAdding(true);
    setAddError('');
    try {
      const feed = await addNewsFeed({ url: url.trim(), languageId });
      setFeeds(list => [...list, feed]);
      setUrl('');
      // Bring in the first articles straight away rather than at the next background check.
      await fetchNow(feed.newsFeedId);
    } catch (e) {
      setAddError(errorText(e, 'Failed to add the feed.'));
    } finally {
      setAdding(false);
    }
  };

  // Enter would otherwise reach the settings form, which doesn't carry the address.
  const handleUrlKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void addFeed();
    }
  };

  const togglePaused = async (feed: NewsFeed) => {
    setBusyFeedId(feed.newsFeedId);
    setMessage(feed.newsFeedId, null);
    try {
      replaceFeed(await updateNewsFeed(feed.newsFeedId, { enabled: !feed.enabled }));
    } catch (e) {
      setMessage(feed.newsFeedId, { variant: 'danger', text: errorText(e, 'Failed to update the feed.') });
    } finally {
      setBusyFeedId(null);
    }
  };

  const removeFeed = async (feed: NewsFeed) => {
    if (!window.confirm(`Stop following "${feed.title}"?\n\nArticles already imported stay in your Library.`)) return;
    setBusyFeedId(feed.newsFeedId);
    try {
      await deleteNewsFeed(feed.newsFeedId);
      setFeeds(list => list.filter(f => f.newsFeedId !== feed.newsFeedId));
      setMessage(feed.newsFeedId, null);
    } catch (e) {
      setMessage(feed.newsFeedId, { variant: 'danger', text: errorText(e, 'Failed to remove the feed.') });
    } finally {
      setBusyFeedId(null);
    }
  };

  const statusLine = (feed: NewsFeed) => {
    const parts: string[] = [];
    if (feed.lastCheckedAt) parts.push(`Checked ${ago(feed.lastCheckedAt)}`);
    else parts.push('Not checked yet');
    parts.push(`${feed.importedLast24Hours} imported in the last 24 h`);
    parts.push(`${feed.articleCount} in your Library`);
    return parts.join(' · ');
  };

  return (
    <div className="settings-control-group">
      <Form.Group className="mb-3" controlId="newsImportEnabled">
        <Form.Check
          type="switch"
          name="newsImportEnabled"
          label="Import news articles from RSS feeds"
          checked={enabled}
          onChange={handleChange}
        />
        <Form.Text className="text-muted" style={{ fontSize: '0.8rem' }}>
          New articles from your feeds are added to the Library under News, a few per feed each day, as texts you
          can read like any other. Feeds are checked every couple of hours.
        </Form.Text>
      </Form.Group>

      {enabled && (
        <>
          <div className="d-flex flex-wrap gap-3 mb-3">
            <Form.Group controlId="newsArticlesPerFeedPerDay">
              <Form.Label>Articles per feed per day</Form.Label>
              <Form.Select
                name="newsArticlesPerFeedPerDay"
                value={settings.newsArticlesPerFeedPerDay}
                onChange={handleChange}
                style={{ width: 'auto' }}
              >
                {withCurrent(PER_DAY_OPTIONS, settings.newsArticlesPerFeedPerDay).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="newsDeleteUnreadAfterDays">
              <Form.Label>Delete articles you never opened after</Form.Label>
              <Form.Select
                name="newsDeleteUnreadAfterDays"
                value={settings.newsDeleteUnreadAfterDays}
                onChange={handleChange}
                style={{ width: 'auto' }}
              >
                {withCurrent(DELETE_AFTER_OPTIONS.map(o => o.value), settings.newsDeleteUnreadAfterDays).map(days => (
                  <option key={days} value={days}>
                    {DELETE_AFTER_OPTIONS.find(o => o.value === days)?.label ?? `${days} days`}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>

          <h6 className="mb-2">Your feeds</h6>
          {loading && !loadError && <Spinner animation="border" size="sm" role="status"><span className="visually-hidden">Loading feeds...</span></Spinner>}
          {loadError && (
            <Alert variant="danger" className="py-2">
              {loadError}{' '}
              <Button variant="link" size="sm" className="p-0 align-baseline" onClick={retryLoad}>Try again</Button>
            </Alert>
          )}
          {!loading && !loadError && feeds.length === 0 && (
            <p className="text-muted small">No feeds yet. Add one below.</p>
          )}

          {feeds.length > 0 && (
            <ul className="list-unstyled mb-3" aria-label="News feeds">
              {feeds.map(feed => {
                const busy = busyFeedId === feed.newsFeedId;
                const message = messages[feed.newsFeedId];
                return (
                  <li key={feed.newsFeedId} className="border rounded p-2 mb-2" style={{ textAlign: 'left' }}>
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <strong className="me-1" style={{ overflowWrap: 'anywhere' }}>{feed.title}</strong>
                      <Badge bg="secondary">{feed.languageName}</Badge>
                      {!feed.enabled && <Badge bg="warning" text="dark">Paused</Badge>}
                    </div>
                    <div className="small text-muted" style={{ overflowWrap: 'anywhere' }}>
                      <a href={feed.url} target="_blank" rel="noopener noreferrer">{hostOf(feed.url)}</a>
                      {' · '}{statusLine(feed)}
                    </div>
                    {feed.lastError && (
                      <div className="small text-danger">Last check failed: {feed.lastError}</div>
                    )}
                    {message && (
                      <Alert variant={message.variant} className="py-1 px-2 my-2 small mb-0">{message.text}</Alert>
                    )}
                    <div className="d-flex flex-wrap gap-2 mt-2">
                      <Button
                        variant="outline-primary"
                        size="sm"
                        type="button"
                        disabled={busy || adding}
                        onClick={() => void fetchNow(feed.newsFeedId)}
                      >
                        {busy ? 'Working...' : 'Fetch now'}
                      </Button>
                      <Button variant="outline-secondary" size="sm" type="button" disabled={busy} onClick={() => void togglePaused(feed)}>
                        {feed.enabled ? 'Pause' : 'Resume'}
                      </Button>
                      {feed.folderId != null && (
                        <Link className="btn btn-outline-secondary btn-sm" to={`/library/${feed.folderId}`}>
                          Open folder
                        </Link>
                      )}
                      <Button variant="outline-danger" size="sm" type="button" disabled={busy} onClick={() => void removeFeed(feed)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* No controlId on the group: it would give the language select the input's id too. */}
          <Form.Group className="mb-2">
            <Form.Label htmlFor="newsFeedUrl">Add a feed</Form.Label>
            <div className="d-flex flex-wrap gap-2">
              <Form.Control
                id="newsFeedUrl"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://feeds.bbci.co.uk/portuguese/rss.xml"
                value={url}
                onChange={event => { setUrl(event.target.value); setAddError(''); }}
                onKeyDown={handleUrlKeyDown}
                disabled={adding}
                style={{ flex: '1 1 16rem', minWidth: 0 }}
              />
              <Form.Select
                aria-label="Language of the feed's articles"
                value={languageId}
                onChange={event => setChosenLanguageId(parseInt(event.target.value, 10))}
                disabled={adding || languages.length === 0}
                style={{ width: 'auto' }}
              >
                {languages.map(l => (
                  <option key={l.languageId} value={l.languageId}>{l.name}</option>
                ))}
              </Form.Select>
              <Button type="button" variant="primary" onClick={() => void addFeed()} disabled={adding || !url.trim() || !languageId}>
                {adding ? 'Adding...' : 'Add'}
              </Button>
            </div>
            <Form.Text className="text-muted" style={{ fontSize: '0.8rem' }}>
              Paste an RSS or Atom feed address, or a news site&apos;s address if it links to its feed.
            </Form.Text>
          </Form.Group>
          {addError && <Alert variant="danger" className="py-2 small">{addError}</Alert>}
        </>
      )}
    </div>
  );
};

export default NewsFeedSettings;
