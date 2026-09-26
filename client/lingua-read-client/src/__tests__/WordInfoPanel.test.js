import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import WordInfoPanel from '../components/reader/WordInfoPanel';

const baseProps = (overrides = {}) => ({
  displayedWord: { term: 'gato', wordId: 11, status: 2, isNew: false },
  selectedWord: 'gato',
  saveSuccess: false,
  translation: {
    value: 'cat',
    setValue: vi.fn(),
    onKeyDown: vi.fn(),
    isTranslating: false,
    error: null
  },
  speech: {
    sentenceTtsEnabled: false,
    canUseSentenceTts: true,
    isSpeakingWord: false,
    onSpeakWord: vi.fn()
  },
  actions: {
    onSaveWord: vi.fn(),
    onMineSentence: vi.fn(),
    processingWord: false
  },
  bookmark: {
    isSentenceBookmarked: false,
    onToggleBookmark: vi.fn()
  },
  language: {
    languageConfig: null,
    setEmbeddedUrl: vi.fn()
  },
  ...overrides
});

describe('WordInfoPanel', () => {
  test('renders a placeholder when no word is displayed', () => {
    render(<WordInfoPanel {...baseProps({ displayedWord: null })} />);
    expect(screen.getByText(/Click\/hover on a word/i)).toBeInTheDocument();
    expect(screen.getByText(/press 1–5 to set its status/)).toBeInTheDocument();
  });

  test('renders the term and current status label', () => {
    render(<WordInfoPanel {...baseProps()} />);
    expect(screen.getByRole('heading', { name: 'gato' })).toBeInTheDocument();
    expect(screen.getByText('Learning')).toBeInTheDocument();
  });

  test('marks the current status button as pressed', () => {
    const { rerender } = render(<WordInfoPanel {...baseProps()} />);
    const pressed = screen.getAllByRole('button', { pressed: true })
      .filter(b => b.closest('[aria-label="Word status"]'));
    expect(pressed.map(b => b.textContent)).toEqual(['2']);
    expect(screen.getByRole('button', { name: /^Ignore$/ })).toHaveAttribute('aria-pressed', 'false');

    rerender(<WordInfoPanel {...baseProps({ displayedWord: { term: 'gato', wordId: 11, status: 6 } })} />);
    expect(screen.getByText('Ignored')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ignore$/ })).toHaveAttribute('aria-pressed', 'true');

    rerender(<WordInfoPanel {...baseProps({ displayedWord: { term: 'gato', status: 0, isNew: true } })} />);
    expect(screen.getByText('Untracked')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { pressed: true })
      .filter(b => b.closest('[aria-label="Word status"]'))).toHaveLength(0);
  });

  test('warns about a translation edit that is not saved yet', () => {
    const translation = (value, saved) => ({
      value, saved, setValue: vi.fn(), onKeyDown: vi.fn(), isTranslating: false, error: null
    });
    const { rerender } = render(<WordInfoPanel {...baseProps({ translation: translation('cat', 'cat') })} />);
    expect(screen.queryByText(/Unsaved edit/)).not.toBeInTheDocument();

    rerender(<WordInfoPanel {...baseProps({ translation: translation('kitten', 'cat') })} />);
    expect(screen.getByText(/Unsaved edit/)).toBeInTheDocument();

    // An untracked word has nothing saved; the hint says how to save it instead.
    rerender(
      <WordInfoPanel
        {...baseProps({
          displayedWord: { term: 'gato', status: 0, isNew: true },
          translation: translation('cat', undefined)
        })}
      />
    );
    expect(screen.queryByText(/Unsaved edit/)).not.toBeInTheDocument();
    expect(screen.getByText(/Not saved yet/)).toBeInTheDocument();
  });

  test('renders five status buttons and invokes onSaveWord with the chosen status', () => {
    const onSaveWord = vi.fn();
    render(
      <WordInfoPanel
        {...baseProps({
          actions: { onSaveWord, onMineSentence: vi.fn(), processingWord: false }
        })}
      />
    );
    const statusButtons = screen.getAllByRole('button').filter(b => /^[1-5]$/.test(b.textContent));
    expect(statusButtons).toHaveLength(5);
    fireEvent.click(statusButtons[2]);
    expect(onSaveWord).toHaveBeenCalledWith(3);
  });

  test('renders an Ignore button that invokes onSaveWord with status 6', () => {
    const onSaveWord = vi.fn();
    render(
      <WordInfoPanel
        {...baseProps({
          actions: { onSaveWord, onMineSentence: vi.fn(), processingWord: false }
        })}
      />
    );
    const ignoreBtn = screen.getByRole('button', { name: /^Ignore$/ });
    fireEvent.click(ignoreBtn);
    expect(onSaveWord).toHaveBeenCalledWith(6);
  });

  test('typing into the translation textarea calls setValue', () => {
    const setValue = vi.fn();
    render(
      <WordInfoPanel
        {...baseProps({
          translation: {
            value: 'cat',
            setValue,
            onKeyDown: vi.fn(),
            isTranslating: false,
            error: null
          }
        })}
      />
    );
    const textarea = screen.getByPlaceholderText(/Translation\/Notes/);
    fireEvent.change(textarea, { target: { value: 'gatito' } });
    expect(setValue).toHaveBeenCalledWith('gatito');
  });

  test('shows a saved indicator when saveSuccess is true', () => {
    render(<WordInfoPanel {...baseProps({ saveSuccess: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  test('Mine Sentence button calls onMineSentence and is disabled for unsaved words', () => {
    const onMineSentence = vi.fn();
    const { rerender } = render(
      <WordInfoPanel
        {...baseProps({
          actions: { onSaveWord: vi.fn(), onMineSentence, processingWord: false }
        })}
      />
    );
    const mineBtn = screen.getByRole('button', { name: /^Mine$/ });
    fireEvent.click(mineBtn);
    expect(onMineSentence).toHaveBeenCalledTimes(1);

    rerender(
      <WordInfoPanel
        {...baseProps({
          displayedWord: { term: 'gato', wordId: 11, status: 0, isNew: true },
          actions: { onSaveWord: vi.fn(), onMineSentence, processingWord: false }
        })}
      />
    );
    expect(screen.getByRole('button', { name: /^Mine$/ })).toBeDisabled();
  });

  test('Mine is enabled for a saved word of status 1, which the API flags isNew', () => {
    render(
      <WordInfoPanel
        {...baseProps({ displayedWord: { term: 'gato', wordId: 11, status: 1, isNew: true } })}
      />
    );
    expect(screen.getByRole('button', { name: /^Mine$/ })).toBeEnabled();
  });

  test('lists active term dictionaries and hides the section when there are none', () => {
    const withDictionaries = (dictionaries) => baseProps({
      language: { languageConfig: { dictionaries }, setEmbeddedUrl: vi.fn() }
    });
    const { rerender } = render(
      <WordInfoPanel
        {...withDictionaries([
          { dictionaryId: 2, isActive: true, purpose: 'terms', displayType: 'popup', urlTemplate: 'https://www.linguee.com/?q=###', sortOrder: 2 },
          { dictionaryId: 1, isActive: true, purpose: 'terms', displayType: 'popup', urlTemplate: 'https://www.wordreference.com/es/###', sortOrder: 1 },
          { dictionaryId: 3, isActive: false, purpose: 'terms', displayType: 'popup', urlTemplate: 'https://example.com/###', sortOrder: 3 },
          { dictionaryId: 4, isActive: true, purpose: 'sentences', displayType: 'popup', urlTemplate: 'https://deepl.com/###', sortOrder: 4 }
        ])}
      />
    );
    expect(screen.getByText('Dictionaries')).toBeInTheDocument();
    const names = screen.getAllByRole('button').map(b => b.textContent);
    expect(names.filter(n => ['Wordreference', 'Linguee', 'Example', 'Deepl'].includes(n)))
      .toEqual(['Wordreference', 'Linguee']);

    rerender(
      <WordInfoPanel
        {...withDictionaries([
          { dictionaryId: 4, isActive: true, purpose: 'sentences', displayType: 'popup', urlTemplate: 'https://deepl.com/###', sortOrder: 1 }
        ])}
      />
    );
    expect(screen.queryByText('Dictionaries')).not.toBeInTheDocument();
  });

  test('bookmark button toggles its variant via onToggleBookmark', () => {
    const onToggleBookmark = vi.fn();
    render(
      <WordInfoPanel
        {...baseProps({
          bookmark: { isSentenceBookmarked: false, onToggleBookmark }
        })}
      />
    );
    const btn = screen.getByTitle(/Bookmark this sentence/);
    fireEvent.click(btn);
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);
  });
});
