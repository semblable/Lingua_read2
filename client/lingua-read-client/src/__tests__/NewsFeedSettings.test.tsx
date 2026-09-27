import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NewsFeedSettings from '../components/settings/NewsFeedSettings';
import type { Settings } from '../contexts/SettingsContext';
import type { NewsFeed } from '../utils/api';
import { addNewsFeed, deleteNewsFeed, fetchNewsFeed, getNewsFeeds, updateNewsFeed } from '../utils/api';

vi.mock('../utils/api', () => ({
  getNewsFeeds: vi.fn(),
  addNewsFeed: vi.fn(),
  updateNewsFeed: vi.fn(),
  deleteNewsFeed: vi.fn(),
  fetchNewsFeed: vi.fn()
}));

const languages = [
  { languageId: 1, name: 'French' },
  { languageId: 2, name: 'Portuguese' }
];

const feed = (overrides: Partial<NewsFeed> = {}): NewsFeed => ({
  newsFeedId: 1,
  url: 'https://feeds.bbci.co.uk/portuguese/rss.xml',
  title: 'BBC News Brasil',
  languageId: 2,
  languageName: 'Portuguese',
  folderId: 7,
  enabled: true,
  createdAt: '2026-09-27T10:00:00Z',
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastError: null,
  importedLast24Hours: 0,
  articleCount: 0,
  ...overrides
});

const renderNews = (settings: Partial<Settings> = {}) => {
  const handleChange = vi.fn();
  render(
    <MemoryRouter>
      <NewsFeedSettings
        settings={{
          newsImportEnabled: true,
          newsArticlesPerFeedPerDay: 3,
          newsDeleteUnreadAfterDays: 14,
          defaultLanguageId: 2,
          ...settings
        } as Settings}
        handleChange={handleChange}
        languages={languages}
      />
    </MemoryRouter>
  );
  return { handleChange };
};

const urlInput = () => screen.getByLabelText('Add a feed');

describe('NewsFeedSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNewsFeeds).mockResolvedValue([]);
  });

  test('shows only the switch while import is off', () => {
    const { handleChange } = renderNews({ newsImportEnabled: false });

    const toggle = screen.getByLabelText('Import news articles from RSS feeds');
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText('Your feeds')).not.toBeInTheDocument();
    expect(getNewsFeeds).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(handleChange).toHaveBeenCalled();
    expect((handleChange.mock.calls[0][0].target as HTMLInputElement).name).toBe('newsImportEnabled');
  });

  test('lists the feeds with their status', async () => {
    vi.mocked(getNewsFeeds).mockResolvedValue([
      feed({ lastCheckedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), importedLast24Hours: 3, articleCount: 12 }),
      feed({
        newsFeedId: 2, title: 'Le Monde', url: 'https://www.lemonde.fr/rss/une.xml', languageName: 'French',
        folderId: null, enabled: false, lastError: 'www.lemonde.fr answered 403 Forbidden.'
      })
    ]);

    renderNews();

    const list = await screen.findByRole('list', { name: 'News feeds' });
    const [bbc, lemonde] = within(list).getAllByRole('listitem');
    expect(within(bbc).getByText('BBC News Brasil')).toBeInTheDocument();
    expect(within(bbc).getByText(/Checked 2h ago · 3 imported in the last 24 h · 12 in your Library/)).toBeInTheDocument();
    expect(within(bbc).getByRole('link', { name: 'feeds.bbci.co.uk' })).toHaveAttribute('href', 'https://feeds.bbci.co.uk/portuguese/rss.xml');
    expect(within(bbc).getByRole('link', { name: 'Open folder' })).toHaveAttribute('href', '/library/7');
    expect(within(bbc).getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    expect(within(lemonde).getByText('Paused')).toBeInTheDocument();
    expect(within(lemonde).getByText(/Not checked yet/)).toBeInTheDocument();
    expect(within(lemonde).getByText('Last check failed: www.lemonde.fr answered 403 Forbidden.')).toBeInTheDocument();
    expect(within(lemonde).queryByRole('link', { name: 'Open folder' })).not.toBeInTheDocument();
    expect(within(lemonde).getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  test('adding a feed checks it right away and reports the result', async () => {
    vi.mocked(addNewsFeed).mockResolvedValue(feed({ newsFeedId: 5 }));
    vi.mocked(fetchNewsFeed).mockResolvedValue({
      success: true, imported: 3, skipped: 0, message: 'Imported 3 articles.',
      feed: feed({ newsFeedId: 5, importedLast24Hours: 3, articleCount: 3 })
    });
    renderNews();
    await screen.findByText('No feeds yet. Add one below.');

    fireEvent.change(urlInput(), { target: { value: ' bbc.com/portuguese ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    // The default language is preselected.
    await waitFor(() => expect(addNewsFeed).toHaveBeenCalledWith({ url: 'bbc.com/portuguese', languageId: 2 }));
    await waitFor(() => expect(fetchNewsFeed).toHaveBeenCalledWith(5));
    expect(await screen.findByText('Imported 3 articles.')).toBeInTheDocument();
    expect(screen.getByText(/3 imported in the last 24 h · 3 in your Library/)).toBeInTheDocument();
    expect(urlInput()).toHaveValue('');
  });

  test('Enter in the address field adds the feed in the chosen language', async () => {
    vi.mocked(addNewsFeed).mockResolvedValue(feed({ newsFeedId: 6, languageId: 1 }));
    vi.mocked(fetchNewsFeed).mockResolvedValue({ success: true, imported: 0, skipped: 0, message: 'No new articles.', feed: null });
    renderNews();

    fireEvent.change(screen.getByLabelText("Language of the feed's articles"), { target: { value: '1' } });
    fireEvent.change(urlInput(), { target: { value: 'https://www.lemonde.fr/rss/une.xml' } });
    fireEvent.keyDown(urlInput(), { key: 'Enter' });

    await waitFor(() => expect(addNewsFeed).toHaveBeenCalledWith({ url: 'https://www.lemonde.fr/rss/une.xml', languageId: 1 }));
    expect(await screen.findByText('No new articles.')).toBeInTheDocument();
  });

  test('a rejected address keeps the input and shows why', async () => {
    vi.mocked(addNewsFeed).mockRejectedValue(new Error("That address isn't an RSS or Atom feed, and the page doesn't link to one."));
    renderNews();

    fireEvent.change(urlInput(), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/isn't an RSS or Atom feed/)).toBeInTheDocument();
    expect(urlInput()).toHaveValue('https://example.com');
    expect(fetchNewsFeed).not.toHaveBeenCalled();
  });

  test('Fetch now shows the result, and a failure as an error', async () => {
    vi.mocked(getNewsFeeds).mockResolvedValue([feed()]);
    vi.mocked(fetchNewsFeed)
      .mockResolvedValueOnce({ success: true, imported: 0, skipped: 0, message: 'Already imported 3 articles from this feed in the last 24 hours, the daily limit.', feed: feed() })
      .mockResolvedValueOnce({ success: false, imported: 0, skipped: 0, message: 'feeds.bbci.co.uk took too long to answer.', feed: feed({ lastError: 'feeds.bbci.co.uk took too long to answer.' }) });
    renderNews();

    fireEvent.click(await screen.findByRole('button', { name: 'Fetch now' }));
    expect(await screen.findByText(/the daily limit/)).toHaveClass('alert-warning');

    fireEvent.click(screen.getByRole('button', { name: 'Fetch now' }));
    expect(await screen.findByText('feeds.bbci.co.uk took too long to answer.')).toHaveClass('alert-danger');
    expect(screen.getByText('Last check failed: feeds.bbci.co.uk took too long to answer.')).toBeInTheDocument();
  });

  test('a feed stays busy while its check runs, whatever happens to another feed', async () => {
    const a = feed();
    const b = feed({ newsFeedId: 2, title: 'RTP Notícias', url: 'https://www.rtp.pt/noticias/rss' });
    vi.mocked(getNewsFeeds).mockResolvedValue([a, b]);
    let finishA: (value: Awaited<ReturnType<typeof fetchNewsFeed>>) => void = () => {};
    vi.mocked(fetchNewsFeed)
      .mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; }))
      .mockResolvedValueOnce({ success: true, imported: 1, skipped: 0, message: 'Imported 1 article.', feed: b });
    renderNews();

    const itemA = (await screen.findByText('BBC News Brasil')).closest('li') as HTMLElement;
    const itemB = screen.getByText('RTP Notícias').closest('li') as HTMLElement;
    fireEvent.click(within(itemA).getByRole('button', { name: 'Fetch now' }));
    expect(within(itemA).getByRole('button', { name: 'Working...' })).toBeDisabled();

    fireEvent.click(within(itemB).getByRole('button', { name: 'Fetch now' }));
    expect(await within(itemB).findByText('Imported 1 article.')).toBeInTheDocument();
    expect(within(itemB).getByRole('button', { name: 'Fetch now' })).toBeEnabled();
    // B finishing must not free A, which is still being checked.
    expect(within(itemA).getByRole('button', { name: 'Working...' })).toBeDisabled();
    expect(within(itemA).getByRole('button', { name: 'Pause' })).toBeDisabled();

    finishA({ success: true, imported: 0, skipped: 0, message: 'No new articles.', feed: a });
    expect(await within(itemA).findByText('No new articles.')).toBeInTheDocument();
    expect(within(itemA).getByRole('button', { name: 'Fetch now' })).toBeEnabled();
  });

  test('Pause and Resume update the feed', async () => {
    vi.mocked(getNewsFeeds).mockResolvedValue([feed()]);
    vi.mocked(updateNewsFeed).mockResolvedValue(feed({ enabled: false }));
    renderNews();

    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(updateNewsFeed).toHaveBeenCalledWith(1, { enabled: false }));
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  test('Remove asks first and keeps the feed when cancelled', async () => {
    vi.mocked(getNewsFeeds).mockResolvedValue([feed()]);
    vi.mocked(deleteNewsFeed).mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderNews();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Articles already imported stay in your Library'));
    expect(deleteNewsFeed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deleteNewsFeed).toHaveBeenCalledWith(1));
    expect(await screen.findByText('No feeds yet. Add one below.')).toBeInTheDocument();
    confirm.mockRestore();
  });

  test('a failed load can be retried', async () => {
    vi.mocked(getNewsFeeds).mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce([feed()]);
    renderNews();

    expect(await screen.findByText(/Network down/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('BBC News Brasil')).toBeInTheDocument();
    expect(getNewsFeeds).toHaveBeenCalledTimes(2);
  });

  test('the two options are settings the page saves, and show a value set elsewhere', () => {
    const { handleChange } = renderNews({ newsArticlesPerFeedPerDay: 4, newsDeleteUnreadAfterDays: 0 });

    const perDay = screen.getByLabelText('Articles per feed per day');
    expect(perDay).toHaveValue('4');
    expect(within(perDay).getAllByRole('option').map(o => o.textContent)).toEqual(['1', '2', '3', '4', '5', '10']);
    const deleteAfter = screen.getByLabelText('Delete articles you never opened after');
    expect(deleteAfter).toHaveValue('0');
    expect(within(deleteAfter).getByRole('option', { name: 'Never' })).toBeInTheDocument();

    fireEvent.change(perDay, { target: { value: '10' } });
    expect((handleChange.mock.calls[0][0].target as HTMLSelectElement).name).toBe('newsArticlesPerFeedPerDay');
  });
});
