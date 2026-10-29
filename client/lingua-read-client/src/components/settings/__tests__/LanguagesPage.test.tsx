import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LanguagesPage from '../LanguagesPage';
import { createLanguage, deleteLanguage, getAllLanguages, updateLanguage } from '../../../utils/api';
import type { Language } from '../../../utils/api/languages';

vi.mock('../../../utils/api', () => ({
  getAllLanguages: vi.fn(), createLanguage: vi.fn(), updateLanguage: vi.fn(),
  deleteLanguage: vi.fn(), resetLanguageContent: vi.fn(),
}));

const english: Language = {
  languageId: 1, name: 'English', code: 'en', showRomanization: false,
  rightToLeft: false, parserType: 'spacedel', splitSentences: '.!?',
  wordCharacters: String.raw`\p{L}\p{M}`, isActiveForTranslation: true,
  dictionaries: [], sentenceSplitExceptions: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAllLanguages).mockResolvedValue([english]);
  vi.mocked(createLanguage).mockImplementation(async input => ({ ...input, languageId: 2 } as Language));
});
afterEach(cleanup);

async function showCatalog() {
  render(<LanguagesPage />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add Polish' })).toBeEnabled());
}

describe('language catalog', () => {
  test('deletes once, then clears the selected language and refreshes the catalog', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(deleteLanguage).mockResolvedValueOnce(undefined).mockRejectedValue(new Error('Language not found'));
    await showCatalog();
    vi.mocked(getAllLanguages).mockResolvedValue([]);
    try {
      fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /English/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Language' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Add English' })).toBeEnabled());
      expect(deleteLanguage).toHaveBeenCalledTimes(1);
      expect(within(screen.getByRole('complementary')).queryByRole('button', { name: /English/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Language not found')).not.toBeInTheDocument();
    } finally {
      confirm.mockRestore();
    }
  });
  test('offers opt-in languages without creating any on page load', async () => {
    await showCatalog();
    expect(createLanguage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'English already added' })).toBeDisabled();
    expect(within(screen.getByRole('complementary')).getByText('English')).toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).queryByText('Polish')).not.toBeInTheDocument();
    const flag = screen.getByRole('heading', { name: 'Polish' }).closest('.language-option')?.querySelector('img');
    expect(flag?.getAttribute('src')).toBe('/flags/pl.svg');
  });

  test.each(['Polski', 'Poland', 'pl'])('finds Polish using %s', async query => {
    await showCatalog();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
    expect(screen.getByRole('button', { name: 'Add Polish' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'French' })).not.toBeInTheDocument();
  });

  test('search handles native names and omitted accents', async () => {
    await showCatalog();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'francais' } });
    expect(screen.getByRole('heading', { name: 'French' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'العربية' } });
    expect(screen.getByRole('heading', { name: 'Arabic' })).toBeInTheDocument();
  });

  test('adds a preset once and immediately updates configured languages', async () => {
    await showCatalog();
    const add = screen.getByRole('button', { name: 'Add Polish' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Polish already added' })).toBeDisabled());
    expect(createLanguage).toHaveBeenCalledTimes(1);
    expect(createLanguage).toHaveBeenCalledWith(expect.objectContaining({ name: 'Polish', code: 'pl', isActiveForTranslation: true }));
    expect(within(screen.getByRole('complementary')).getByText('Polish')).toBeInTheDocument();
    expect(screen.getByText(/Polish added\./)).toBeInTheDocument();
  });

  test('a failed add preserves the list and allows retry', async () => {
    vi.mocked(createLanguage).mockRejectedValueOnce(new Error('Connection lost. Try again.'));
    await showCatalog();
    fireEvent.click(screen.getByRole('button', { name: 'Add Arabic' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    expect(within(screen.getByRole('complementary')).queryByText('Arabic')).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Add Arabic' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await screen.findByRole('button', { name: 'Arabic already added' });
    expect(createLanguage).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'ar', rightToLeft: true, splitSentences: '.!?؟' }));
  });

  test('loading failure blocks adds until the list can be checked for duplicates', async () => {
    vi.mocked(getAllLanguages).mockRejectedValueOnce(new Error('Cannot load languages'));
    render(<LanguagesPage />);
    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('button', { name: 'Add Polish' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Polish' })).toBeEnabled());
  });

  test('recognizes saved regional codes and can hide already added languages', async () => {
    vi.mocked(getAllLanguages).mockResolvedValue([{ ...english, code: 'EN_us' }, { ...english, languageId: 2, name: 'Portuguese', code: 'pt-BR' }]);
    await showCatalog();
    expect(screen.getByRole('button', { name: 'Portuguese already added' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Only show languages to add' }));
    expect(screen.queryByRole('heading', { name: 'English' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Portuguese' })).not.toBeInTheDocument();
  });

  test('keeps custom setup and existing configuration editing available', async () => {
    await showCatalog();
    fireEvent.click(screen.getByRole('button', { name: /Set up a custom language/ }));
    expect(screen.getByLabelText('Language Name')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Back to languages' }));
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /English/ }));
    expect(screen.getByLabelText('Language Name')).toHaveValue('English');
    fireEvent.change(screen.getByLabelText('Language Name'), { target: { value: 'English reading' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Language' }));
    await waitFor(() => expect(updateLanguage).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'English reading', code: 'en' })));
  });

  test('provides a useful empty result and explains limited segmentation', async () => {
    await showCatalog();
    expect(screen.getByText(/Chinese, Japanese and Thai currently split/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'not-a-language' } });
    expect(screen.getByRole('heading', { name: 'No languages found' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('button', { name: 'Add Polish' })).toBeInTheDocument();
  });
});
