import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NewsFeedBrowser, { MAX_PICKS } from '../components/news/NewsFeedBrowser';
import type { NewsFeedEntry, NewsFeedFetchResult } from '../utils/api';
import { getNewsFeedEntries, importNewsFeedEntries } from '../utils/api';

vi.mock('../utils/api', () => ({
  getNewsFeedEntries: vi.fn(),
  importNewsFeedEntries: vi.fn()
}));

const entry = (overrides: Partial<NewsFeedEntry> = {}): NewsFeedEntry => ({
  key: 'k-new',
  title: 'Governo anuncia medidas',
  link: 'https://news.example.com/1',
  publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  summary: 'O governo anunciou hoje novas medidas.',
  status: 'new',
  textId: null,
  wordCount: null,
  ...overrides
});

const threeEntries = [
  entry(),
  entry({ key: 'k-imported', title: 'Já importado', status: 'imported', textId: 42 }),
  entry({ key: 'k-skipped', title: 'Curto demais', status: 'skipped', summary: null })
];

const result = (overrides: Partial<NewsFeedFetchResult> = {}): NewsFeedFetchResult =>
  ({ success: true, imported: 2, skipped: 0, message: 'Imported 2 articles.', feed: null, entries: [], ...overrides });

const renderBrowser = (props: Partial<React.ComponentProps<typeof NewsFeedBrowser>> = {}) => {
  const onHide = vi.fn();
  const onImported = vi.fn();
  render(
    <MemoryRouter>
      <NewsFeedBrowser feedId={5} feedTitle="BBC News Brasil" onHide={onHide} onImported={onImported} {...props} />
    </MemoryRouter>
  );
  return { onHide, onImported };
};

const row = (title: string) => screen.getByText(title).closest('li') as HTMLElement;
const filter = (name: RegExp) => screen.getByRole('button', { name });

describe('NewsFeedBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNewsFeedEntries).mockResolvedValue({ feed: null, entries: threeEntries });
  });

  test('opens on the articles still to import, with what the import made of each', async () => {
    renderBrowser();

    expect(screen.getByText('Articles in BBC News Brasil')).toBeInTheDocument();
    expect(await screen.findByText('Governo anuncia medidas')).toBeInTheDocument();
    expect(getNewsFeedEntries).toHaveBeenCalledWith(5);
    expect(filter(/^To import 2/)).toHaveAttribute('aria-pressed', 'true');
    expect(filter(/^Imported 1/)).toHaveAttribute('aria-pressed', 'false');
    expect(filter(/^All 3/)).toBeInTheDocument();

    const fresh = row('Governo anuncia medidas');
    expect(within(fresh).getByLabelText('Select Governo anuncia medidas')).not.toBeChecked();
    expect(within(fresh).getByText('2h ago')).toBeInTheDocument();
    expect(within(fresh).getByText('O governo anunciou hoje novas medidas.')).toBeInTheDocument();
    expect(within(fresh).getByRole('link', { name: 'Original: Governo anuncia medidas' })).toHaveAttribute('href', 'https://news.example.com/1');

    // Skipped before: can be picked again.
    const skipped = row('Curto demais');
    expect(within(skipped).getByText('Skipped before')).toBeInTheDocument();
    expect(within(skipped).getByRole('checkbox')).toBeEnabled();

    // Imported ones are under their own filter.
    expect(screen.queryByText('Já importado')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  test('the Imported and All filters show the imported articles, with a way to read them', async () => {
    renderBrowser();
    await screen.findByText('Governo anuncia medidas');

    fireEvent.click(filter(/^Imported/));

    const imported = row('Já importado');
    expect(within(imported).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(imported).getByText('Imported')).toBeInTheDocument();
    expect(within(imported).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/texts/42');
    expect(screen.queryByText('Governo anuncia medidas')).not.toBeInTheDocument();

    fireEvent.click(filter(/^All/));
    expect(screen.getByRole('list', { name: 'Articles in the feed' }).querySelectorAll('li')).toHaveLength(3);
  });

  test('opens on all articles when everything is imported already', async () => {
    vi.mocked(getNewsFeedEntries).mockResolvedValue({ feed: null, entries: [threeEntries[1]] });
    renderBrowser();

    expect(await screen.findByText('Já importado')).toBeInTheDocument();
    expect(filter(/^All 1/)).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(filter(/^To import 0/));
    expect(screen.getByText('Everything in the feed is imported already.')).toBeInTheDocument();
  });

  test('searching narrows the list by title and summary, ignoring accents', async () => {
    renderBrowser();
    await screen.findByText('Governo anuncia medidas');

    fireEvent.change(screen.getByLabelText('Search the articles'), { target: { value: 'NOVAS MEDIDAS' } });
    expect(screen.getByText('Governo anuncia medidas')).toBeInTheDocument();
    expect(screen.queryByText('Curto demais')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search the articles'), { target: { value: 'demáis' } });
    expect(screen.getByText('Curto demais')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search the articles'), { target: { value: 'futebol' } });
    expect(screen.getByText('No articles match "futebol".')).toBeInTheDocument();
  });

  test('shows the length of an article the feed carries whole', async () => {
    vi.mocked(getNewsFeedEntries).mockResolvedValue({ feed: null, entries: [entry({ wordCount: 1234 })] });
    renderBrowser();

    expect(await screen.findByText(`~${(1234).toLocaleString()} words`)).toBeInTheDocument();
  });

  test('a click anywhere on a row picks it, except on its link', async () => {
    renderBrowser();
    await screen.findByText('Governo anuncia medidas');

    fireEvent.click(screen.getByText('O governo anunciou hoje novas medidas.'));
    expect(screen.getByLabelText('Select Governo anuncia medidas')).toBeChecked();
    expect(row('Governo anuncia medidas')).toHaveClass('news-entry-selected');

    fireEvent.click(screen.getByText('Curto demais'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Governo anuncia medidas'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  test('Select all picks the listed articles, and Clear unpicks them', async () => {
    renderBrowser();
    await screen.findByText('Governo anuncia medidas');

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  test('imports the picked articles, then keeps the imported ones in view with a way to read them', async () => {
    vi.mocked(importNewsFeedEntries).mockResolvedValue(result({
      entries: [
        { key: 'k-new', status: 'imported', textId: 77 },
        { key: 'k-skipped', status: 'imported', textId: 78 }
      ]
    }));
    const { onImported } = renderBrowser();
    await screen.findByText('Governo anuncia medidas');

    fireEvent.click(screen.getByLabelText('Select Governo anuncia medidas'));
    fireEvent.click(screen.getByLabelText('Select Curto demais'));
    vi.mocked(getNewsFeedEntries).mockResolvedValue({
      feed: null,
      entries: [
        entry({ status: 'imported', textId: 77 }),
        threeEntries[1],
        entry({ key: 'k-skipped', title: 'Curto demais', status: 'imported', textId: 78, summary: null })
      ]
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import 2' }));

    expect(screen.getByText('Downloading 2 articles, this can take a minute...')).toBeInTheDocument();
    expect(await screen.findByText('Imported 2 articles.')).toHaveClass('alert-success');
    expect(importNewsFeedEntries).toHaveBeenCalledWith(5, ['k-new', 'k-skipped']);
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ imported: 2 }));
    await waitFor(() => expect(getNewsFeedEntries).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(filter(/^To import 0/)).toBeInTheDocument());

    // Still listed under "To import" until the dialog closes, now to be read.
    expect(within(row('Governo anuncia medidas')).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/texts/77');
    expect(within(row('Curto demais')).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/texts/78');
    expect(screen.queryByText('Já importado')).not.toBeInTheDocument();
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  test("an article that couldn't be loaded stays picked, marked to try again", async () => {
    vi.mocked(importNewsFeedEntries).mockResolvedValue(result({
      imported: 1,
      message: "Imported 1 article. 1 couldn't be loaded right now (news.example.com took too long to answer); try again later.",
      entries: [
        { key: 'k-new', status: 'imported', textId: 77 },
        { key: 'k-skipped', status: 'unreachable', textId: null }
      ]
    }));
    renderBrowser();
    await screen.findByText('Governo anuncia medidas');

    fireEvent.click(screen.getByLabelText('Select Governo anuncia medidas'));
    fireEvent.click(screen.getByLabelText('Select Curto demais'));
    fireEvent.click(screen.getByRole('button', { name: 'Import 2' }));

    expect(await screen.findByText(/couldn't be loaded right now/)).toHaveClass('alert-success');
    const retry = row('Curto demais');
    expect(within(retry).getByText("Couldn't load, try again")).toBeInTheDocument();
    expect(within(retry).queryByText('Skipped before')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select Curto demais')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Import 1' })).toBeEnabled();
  });

  test('a refused import keeps the picks and says why', async () => {
    vi.mocked(importNewsFeedEntries).mockResolvedValue(
      result({ success: false, imported: 0, message: 'This feed is being checked right now. Try again in a minute.' }));
    const { onImported } = renderBrowser();
    await screen.findByText('Governo anuncia medidas');

    fireEvent.click(screen.getByLabelText('Select Governo anuncia medidas'));
    fireEvent.click(screen.getByRole('button', { name: 'Import 1' }));

    expect(await screen.findByText(/being checked right now/)).toHaveClass('alert-danger');
    expect(screen.getByLabelText('Select Governo anuncia medidas')).toBeChecked();
    expect(onImported).not.toHaveBeenCalled();
  });

  test(`picks stop at ${MAX_PICKS}`, async () => {
    const many = Array.from({ length: MAX_PICKS + 1 }, (_, i) => entry({ key: `k${i}`, title: `Artigo ${i}` }));
    vi.mocked(getNewsFeedEntries).mockResolvedValue({ feed: null, entries: many });
    renderBrowser();
    await screen.findByText('Artigo 0');

    fireEvent.click(screen.getByRole('button', { name: `Select first ${MAX_PICKS}` }));

    expect(screen.getByText(`${MAX_PICKS} selected (up to ${MAX_PICKS} at a time)`)).toBeInTheDocument();
    expect(screen.getByLabelText(`Select Artigo ${MAX_PICKS - 1}`)).toBeChecked();
    expect(screen.getByLabelText(`Select Artigo ${MAX_PICKS}`)).toBeDisabled();
    // Unpicking one frees a place again.
    fireEvent.click(screen.getByLabelText('Select Artigo 0'));
    expect(screen.getByLabelText(`Select Artigo ${MAX_PICKS}`)).toBeEnabled();
  });

  test('a feed that can\'t be loaded can be tried again', async () => {
    vi.mocked(getNewsFeedEntries)
      .mockRejectedValueOnce(new Error('news.example.com answered 503 Service Unavailable.'))
      .mockResolvedValueOnce({ feed: null, entries: threeEntries });
    renderBrowser();

    expect(await screen.findByText(/answered 503/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Governo anuncia medidas')).toBeInTheDocument();
    expect(screen.queryByText(/answered 503/)).not.toBeInTheDocument();
  });

  test('stays closed without a feed', () => {
    renderBrowser({ feedId: null });

    expect(screen.queryByText('Articles in BBC News Brasil')).not.toBeInTheDocument();
    expect(getNewsFeedEntries).not.toHaveBeenCalled();
  });

  test('Close and Open both hide it, and it opens fresh again', async () => {
    const { onHide } = renderBrowser();
    await screen.findByText('Governo anuncia medidas');
    fireEvent.click(filter(/^Imported/));

    fireEvent.click(screen.getByRole('link', { name: 'Open' }));
    expect(onHide).toHaveBeenCalledTimes(1);

    // The footer's Close (the header's × is labelled "Close" too).
    fireEvent.click(screen.getByText('Close'));
    expect(onHide).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(filter(/^To import/)).toHaveAttribute('aria-pressed', 'true'));
  });
});
