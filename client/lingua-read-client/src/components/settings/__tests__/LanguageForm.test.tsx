import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  createLanguage: vi.fn(),
  updateLanguage: vi.fn(),
  deleteLanguage: vi.fn(),
  resetLanguageContent: vi.fn(),
}));

import LanguageForm from '../LanguageForm';
import type { Language } from '../../../utils/api/languages';

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
