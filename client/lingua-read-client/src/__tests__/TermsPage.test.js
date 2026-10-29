import React from 'react';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import TermsPage from '../pages/TermsPage';
import { saveAs } from 'file-saver';
import {
  getAllLanguages,
  getPaginatedWordsByLanguage,
  exportWordsCsv,
  addTermsBatch,
  deleteWord
} from '../utils/api';

vi.mock('../utils/api', () => ({
  getAllLanguages: vi.fn(),
  getPaginatedWordsByLanguage: vi.fn(),
  exportWordsCsv: vi.fn(),
  addTermsBatch: vi.fn(),
  deleteWord: vi.fn()
}));

vi.mock('file-saver', () => ({
  saveAs: vi.fn()
}));

const renderPage = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <TermsPage />
    </MemoryRouter>
  );

const mockLanguages = [
  { languageId: 1, name: 'Spanish' },
  { languageId: 2, name: 'French' }
];

const mockTerms = [
  {
    wordId: 11,
    term: 'gato',
    translation: 'cat',
    status: 3,
    createdAt: '2026-04-01T00:00:00Z'
  },
  {
    wordId: 12,
    term: 'perro',
    translation: 'dog',
    status: 2,
    createdAt: '2026-04-02T00:00:00Z'
  }
];

describe('TermsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getAllLanguages.mockResolvedValue(mockLanguages);
    getPaginatedWordsByLanguage.mockResolvedValue({
      items: mockTerms,
      totalCount: mockTerms.length,
      totalPages: 1
    });
    deleteWord.mockResolvedValue(undefined);
  });

  test('renders the language dropdown after languages load', async () => {
    renderPage();
    expect(await screen.findByText('Spanish')).toBeInTheDocument();
    expect(screen.getByText('French')).toBeInTheDocument();
  });

  test('fetches and renders terms when a language is selected', async () => {
    renderPage();
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });

    expect(await screen.findByText('gato')).toBeInTheDocument();
    expect(screen.getByText('perro')).toBeInTheDocument();
    expect(getPaginatedWordsByLanguage).toHaveBeenCalledWith(
      '1',
      1,
      20,
      [],
      'created_desc',
      '',
      false
    );
  });

  test('renders the no-terms-found row when the response is empty', async () => {
    getPaginatedWordsByLanguage.mockResolvedValue({
      items: [],
      totalCount: 0,
      totalPages: 0
    });
    renderPage();
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });

    expect(
      await screen.findByText(/No terms found for the selected criteria/i)
    ).toBeInTheDocument();
  });

  test('deletes a term after confirmation and refetches', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });
    await screen.findByText('gato');

    expect(screen.queryByRole('button', { name: 'Delete term' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for gato' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete term' }));

    await waitFor(() => expect(deleteWord).toHaveBeenCalledWith(11));
    // Initial fetch + refetch after delete
    expect(getPaginatedWordsByLanguage).toHaveBeenCalledTimes(2);
    confirmSpy.mockRestore();
  });

  test('shows an alert when getPaginatedWordsByLanguage rejects', async () => {
    getPaginatedWordsByLanguage.mockRejectedValue(new Error('boom'));
    renderPage();
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });

    expect(
      await screen.findByText(/Failed to fetch terms: boom/)
    ).toBeInTheDocument();
  });

  test('filters by the Ignored status (6) when its checkbox is selected', async () => {
    renderPage();
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });
    await screen.findByText('gato');

    const ignoredCheckbox = screen.getByLabelText('Ignored');
    fireEvent.click(ignoredCheckbox);

    await waitFor(() =>
      expect(getPaginatedWordsByLanguage).toHaveBeenLastCalledWith(
        '1',
        1,
        20,
        [6],
        'created_desc',
        '',
        false
      )
    );
  });

  test.each(['simple', 'context', 'anki'])('exports %s with selected language/status and downloads server filename', async format => {
    const blob = new Blob(['fixture']);
    exportWordsCsv.mockResolvedValue({ blob, filename: `fixture-${format}.txt` });
    renderPage();
    fireEvent.change(await screen.findByLabelText(/^Language$/i), { target: { value: '1' } });
    await screen.findByText('gato');
    fireEvent.click(screen.getByLabelText('Ignored'));
    await waitFor(() => expect(getPaginatedWordsByLanguage).toHaveBeenLastCalledWith('1', 1, 20, [6], 'created_desc', '', false));
    fireEvent.change(screen.getByLabelText('Export format'), { target: { value: format } });
    fireEvent.click(screen.getByRole('button', { name: format === 'anki' ? 'Export Anki' : 'Export CSV' }));
    fireEvent.click(screen.getByText('Export Filtered'));
    await waitFor(() => expect(exportWordsCsv).toHaveBeenLastCalledWith('1', [6], format));
    expect(saveAs).toHaveBeenCalledWith(blob, `fixture-${format}.txt`);
  });

  test('all-for-language export intentionally ignores status filters and shows failures', async () => {
    exportWordsCsv.mockRejectedValue(new Error('Export unavailable'));
    renderPage();
    fireEvent.change(await screen.findByLabelText(/^Language$/i), { target: { value: '1' } });
    await screen.findByText('gato');
    fireEvent.change(screen.getByLabelText('Export format'), { target: { value: 'context' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    fireEvent.click(screen.getByText('Export All for Language'));
    await screen.findByText('Failed to export vocabulary: Export unavailable');
    expect(exportWordsCsv).toHaveBeenCalledWith('1', [], 'context');
  });

  test('optionally shows highlighted sentences, expands examples, and remembers the preference', async () => {
    getPaginatedWordsByLanguage.mockResolvedValue({
      items: [{ ...mockTerms[0], sources: [{ textTitle: 'Animal stories', textId: 42 }], sentences: [
        { sentence: 'El Gato duerme.', textTitle: 'Animal stories', textId: 42 },
        { sentence: 'Veo un gato.', textTitle: 'Deleted source', textId: null }
      ] }, mockTerms[1]], totalCount: 2, totalPages: 1
    });
    const view = renderPage();
    fireEvent.change(await screen.findByLabelText(/^Language$/i), { target: { value: '1' } });
    await screen.findByText('gato');
    expect(screen.getByLabelText('Show sentences')).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Animal stories' })).toHaveAttribute('href', '/texts/42');
    expect(screen.queryByRole('columnheader', { name: 'Sentence' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Show sentences'));
    const title = await screen.findByRole('link', { name: 'Animal stories' });
    expect(title).toBeInTheDocument();
    expect(screen.getByText('Gato').tagName).toBe('MARK');
    expect(screen.getByRole('columnheader', { name: 'Sentence' })).toBeInTheDocument();
    expect(screen.queryByText('Deleted source')).not.toBeInTheDocument();
    expect(screen.getByLabelText('No matching saved sentence')).toHaveTextContent('—');
    expect(getPaginatedWordsByLanguage).toHaveBeenLastCalledWith('1', 1, 20, [], 'created_desc', '', true);

    fireEvent.click(screen.getByRole('button', { name: 'Expand sentences for gato' }));
    expect(screen.getByText('Deleted source')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Open in reader/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sentences for gato' }));
    expect(screen.queryByText('Deleted source')).not.toBeInTheDocument();

    view.unmount();
    renderPage();
    expect(screen.getByLabelText('Show sentences')).toBeChecked();
    await screen.findByRole('link', { name: 'Animal stories' });
    fireEvent.click(screen.getByLabelText('Show sentences'));
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Sentence' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Animal stories' })).toBeInTheDocument();
    expect(localStorage.getItem('termsShowSentences')).toBe('false');
  });

  test('a long sentence expands to its complete text', async () => {
    localStorage.setItem('termsShowSentences', 'true');
    localStorage.setItem('lastSelectedLanguage', '1');
    const sentence = `Un gato ${'duerme tranquilamente. '.repeat(20)}Fin.`;
    getPaginatedWordsByLanguage.mockResolvedValue({
      items: [{ ...mockTerms[0], sentences: [{ sentence }] }], totalCount: 1, totalPages: 1
    });
    renderPage();
    const expand = await screen.findByRole('button', { name: 'Expand sentences for gato' });
    expect(screen.queryByText(/Fin\./)).not.toBeInTheDocument();
    fireEvent.click(expand);
    expect(screen.getByText(/Fin\./)).toBeInTheDocument();
  });

  test('uses named status filters', async () => {
    renderPage();
    await screen.findByText('Spanish');
    for (const label of ['New', 'Learning', 'Familiar', 'Advanced', 'Known', 'Ignored']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeInTheDocument();
    }
  });

  test('keeps the term visible when it appears late in a long sentence', async () => {
    localStorage.setItem('termsShowSentences', 'true');
    localStorage.setItem('lastSelectedLanguage', '1');
    getPaginatedWordsByLanguage.mockResolvedValue({
      items: [{ ...mockTerms[0], sentences: [{ sentence: `${'Mucho antes. '.repeat(30)}El Gato duerme.` }] }],
      totalCount: 1, totalPages: 1
    });
    renderPage();
    expect((await screen.findByText('Gato')).tagName).toBe('MARK');
    expect(screen.getByRole('button', { name: 'Expand sentences for gato' })).toHaveTextContent('Show full sentence');
  });

  test('ignores a stale context request after the toggle changes again', async () => {
    let resolveContext;
    renderPage();
    fireEvent.change(await screen.findByLabelText(/^Language$/i), { target: { value: '1' } });
    await screen.findByText('gato');
    getPaginatedWordsByLanguage.mockImplementationOnce(() => new Promise(resolve => { resolveContext = resolve; }));
    fireEvent.click(screen.getByLabelText('Show sentences'));
    await waitFor(() => expect(resolveContext).toBeTypeOf('function'));
    // Existing rows remain visible while context loads.
    expect(screen.getByText('gato')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show sentences'));
    await waitFor(() => expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false'));
    await act(async () => {
      resolveContext({ items: [{ ...mockTerms[0], term: 'stale result' }], totalCount: 1, totalPages: 1 });
    });
    expect(screen.getByText('gato')).toBeInTheDocument();
    expect(screen.queryByText('stale result')).not.toBeInTheDocument();
  });

  test('allows expanding a sentence that becomes longer after language substitutions', async () => {
    localStorage.setItem('termsShowSentences', 'true');
    localStorage.setItem('lastSelectedLanguage', '1');
    getAllLanguages.mockResolvedValue([{ ...mockLanguages[0], characterSubstitutions: 'x=elefante' }]);
    getPaginatedWordsByLanguage.mockResolvedValue({
      items: [{ ...mockTerms[0], term: 'elefante', sentences: [{ sentence: `${'x '.repeat(30)}Fin.` }] }],
      totalCount: 1, totalPages: 1
    });
    renderPage();
    const expand = await screen.findByRole('button', { name: 'Expand sentences for elefante' });
    expect(screen.queryByText(/Fin\./)).not.toBeInTheDocument();
    fireEvent.click(expand);
    expect(screen.getByText(/Fin\./)).toBeInTheDocument();
    expect(screen.getAllByText('elefante', { selector: 'mark' })).toHaveLength(30);
  });

  test('ignores a stale request failure while the current request is still loading', async () => {
    let rejectContext;
    let resolveCurrent;
    renderPage();
    fireEvent.change(await screen.findByLabelText(/^Language$/i), { target: { value: '1' } });
    await screen.findByText('gato');
    getPaginatedWordsByLanguage
      .mockImplementationOnce(() => new Promise((resolve, reject) => { rejectContext = reject; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveCurrent = resolve; }));
    fireEvent.click(screen.getByLabelText('Show sentences'));
    await waitFor(() => expect(rejectContext).toBeTypeOf('function'));
    fireEvent.click(screen.getByLabelText('Show sentences'));
    await waitFor(() => expect(resolveCurrent).toBeTypeOf('function'));

    await act(async () => { rejectContext(new Error('stale failure')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Actions for gato' })).toBeDisabled();

    await act(async () => { resolveCurrent({ items: mockTerms, totalCount: 2, totalPages: 1 }); });
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByText('gato')).toBeInTheDocument();
  });

  test('prefers matching saved sentences and keeps unrelated context out of the examples', async () => {
    localStorage.setItem('lastSelectedLanguage', '1');
    localStorage.setItem('termsShowSentences', 'true');
    getPaginatedWordsByLanguage.mockResolvedValue({
      items: [{ ...mockTerms[0], sources: [{ textTitle: 'Newest source B', textId: 2 }], sentences: [
        { sentence: 'Una frase sin este animal.', textTitle: 'Newest source B', textId: 2 },
        { sentence: 'El Gato duerme.', textTitle: 'Matching source A', textId: 1 }
      ] }, { ...mockTerms[1], sentences: [{ sentence: 'Otra frase sin relación.' }] }], totalCount: 2, totalPages: 1
    });
    renderPage();
    expect((await screen.findByText('Gato')).tagName).toBe('MARK');
    expect(screen.queryByText('Una frase sin este animal.')).not.toBeInTheDocument();
    expect(screen.queryByText('Otra frase sin relación.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('No matching saved sentence')).toBeInTheDocument();
    const sentenceCell = screen.getByText('Gato').closest('td');
    expect(within(sentenceCell).getByText('Matching source A')).toBeInTheDocument();
    expect(within(sentenceCell).queryByText('Newest source B')).not.toBeInTheDocument();
    expect(within(sentenceCell).getByRole('link', { name: /Open in reader/ })).toHaveAttribute('href', '/texts/1');
  });

  test('shows source links and deleted source titles with sentences hidden', async () => {
    localStorage.setItem('lastSelectedLanguage', '1');
    getPaginatedWordsByLanguage.mockResolvedValue({
      items: [{ ...mockTerms[0], sources: [
        { textId: 42, textTitle: 'Animal stories' },
        { textId: null, textTitle: 'Deleted source' }
      ] }, mockTerms[1]], totalCount: 2, totalPages: 1
    });
    renderPage();
    expect(await screen.findByRole('columnheader', { name: 'Source' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Animal stories' })).toHaveAttribute('href', '/texts/42');
    fireEvent.click(screen.getByText('1 more source'));
    expect(screen.getByText('Deleted source').closest('a')).toBeNull();
    expect(screen.getByLabelText('No source')).toHaveTextContent('—');
    expect(screen.queryByRole('columnheader', { name: 'Sentence' })).not.toBeInTheDocument();
  });

  test('uses compact dates with precise timestamps and accessible sorting', async () => {
    localStorage.setItem('lastSelectedLanguage', '1');
    renderPage();
    const row = (await screen.findByText('gato')).closest('tr');
    const date = row.querySelector('time');
    expect(date).toHaveAttribute('datetime', mockTerms[0].createdAt);
    expect(date).toHaveAttribute('title', new Date(mockTerms[0].createdAt).toLocaleString());
    expect(date.textContent).not.toMatch(/\d+:\d+/);
    expect(within(row).getAllByRole('cell')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Term' }));
    await waitFor(() => expect(getPaginatedWordsByLanguage).toHaveBeenLastCalledWith('1', 1, 20, [], 'term_asc', '', false));
    expect(screen.getByRole('columnheader', { name: 'Term' })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByText('Showing 1 to 2 of 2 terms')).toBeInTheDocument();
  });

  test.each([false, true])('empty table spans every visible column (sentences: %s)', async show => {
    localStorage.setItem('lastSelectedLanguage', '1');
    localStorage.setItem('termsShowSentences', String(show));
    getPaginatedWordsByLanguage.mockResolvedValue({ items: [], totalCount: 0, totalPages: 0 });
    renderPage();
    const emptyCell = await screen.findByText('No terms found for the selected criteria.');
    expect(emptyCell).toHaveAttribute('colspan', show ? '7' : '6');
    expect(screen.getByText('Showing 0 to 0 of 0 terms')).toBeInTheDocument();
  });
});
