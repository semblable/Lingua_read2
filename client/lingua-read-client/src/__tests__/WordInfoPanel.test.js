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
  });

  test('renders the term and current status label', () => {
    render(<WordInfoPanel {...baseProps()} />);
    expect(screen.getByText('gato')).toBeInTheDocument();
    expect(screen.getByText(/Status: Learning/)).toBeInTheDocument();
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
    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });

  test('Mine Sentence button calls onMineSentence and is disabled for isNew words', () => {
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
