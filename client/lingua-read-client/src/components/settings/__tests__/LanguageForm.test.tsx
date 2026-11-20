import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  createLanguage: vi.fn(),
  updateLanguage: vi.fn(),
  deleteLanguage: vi.fn(),
  resetLanguageContent: vi.fn(),
}));

import LanguageForm from '../LanguageForm';
import type { Language } from '../../../utils/api/languages';
import { updateLanguage } from '../../../utils/api';

const noop = () => {};

describe('LanguageForm word characters', () => {
  afterEach(cleanup);

  test('a new language defaults to any letter plus combining marks', () => {
    // The old default, a-zA-Z, split every accented word of a language the
    // user added (Polish, Czech, Greek, ...).
    render(<LanguageForm language={null} onSave={noop} onCancel={noop} onDelete={noop} />);

    const input = screen.getByLabelText('Word Characters (Regex)') as HTMLInputElement;
    expect(input.value).toBe(String.raw`\p{L}\p{M}`);
  });

  test('an existing language keeps its stored value', () => {
    const russian = {
      languageId: 7,
      name: 'Russian',
      code: 'ru',
      wordCharacters: String.raw`\p{L}\p{M}'-`,
      dictionaries: [],
      sentenceSplitExceptions: [],
    } as unknown as Language;

    render(<LanguageForm language={russian} onSave={noop} onCancel={noop} onDelete={noop} />);

    const input = screen.getByLabelText('Word Characters (Regex)') as HTMLInputElement;
    expect(input.value).toBe(String.raw`\p{L}\p{M}'-`);
  });
});

describe('LanguageForm parser type', () => {
  afterEach(cleanup);

  test('manages segmentation at import time and preserves the stored parser on save', async () => {
    const japanese = {
      languageId: 9,
      name: 'Japanese',
      code: 'ja',
      parserType: 'mecab',
      splitSentences: '.!?。！？',
      wordCharacters: String.raw`\p{L}\p{M}`,
      dictionaries: [],
      sentenceSplitExceptions: [],
    } as unknown as Language;

    render(<LanguageForm language={japanese} onSave={noop} onCancel={noop} onDelete={noop} />);
    expect(screen.queryByLabelText('Parser Type')).toBeNull();
    expect(screen.queryByTestId('parser-not-implemented')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Update Language' }));
    await waitFor(() => expect(updateLanguage).toHaveBeenCalledWith(9, expect.objectContaining({ parserType: 'mecab' })));
  });
});

describe('LanguageForm dictionary display', () => {
  afterEach(cleanup);

  test('lets the learner choose an in-reader lookup or a new tab', () => {
    render(<LanguageForm language={null} onSave={noop} onCancel={noop} onDelete={noop} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add Dictionary' }));
    const display = screen.getByRole('combobox', { name: 'Display' });
    expect((display as HTMLSelectElement).value).toBe('embedded');
    fireEvent.change(display, { target: { value: 'popup' } });
    expect((display as HTMLSelectElement).value).toBe('popup');
  });
});

describe('LanguageForm unavailable romanization', () => {
  afterEach(cleanup);

  test('hides the ineffective switch and preserves an existing true preference on save', async () => {
    const language = { languageId: 42, name: 'Russian', code: 'ru', showRomanization: true,
      rightToLeft: false, parserType: 'spacedel', wordCharacters: String.raw`\p{L}\p{M}`,
      splitSentences: '.!?', dictionaries: [], sentenceSplitExceptions: [] } as unknown as Language;
    render(<LanguageForm language={language} onSave={noop} onCancel={noop} onDelete={noop} />);
    expect(screen.queryByLabelText('Show Romanization')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Update Language' }));
    await waitFor(() => expect(updateLanguage).toHaveBeenCalledWith(42, expect.objectContaining({ showRomanization: true })));
  });
});
