import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../utils/api', () => ({
  translateText: vi.fn(),
  translateSelectionWithContext: vi.fn()
}));

import { translateText, translateSelectionWithContext } from '../utils/api';
import { useWordTranslation } from '../hooks/useWordTranslation';

const baseText = {
  textId: 1,
  languageCode: 'es',
  content: 'hola',
  languageId: 5
};

const baseSettings = {
  autoTranslateWords: true,
  translationTargetLanguageCode: 'EN'
};

const renderTranslationHook = (overrides = {}) => {
  const applyTranslationToDisplayedWord = vi.fn();
  const args = {
    text: overrides.text === undefined ? baseText : overrides.text,
    globalSettings: { ...baseSettings, ...overrides.globalSettings },
    targetLanguageCode: overrides.targetLanguageCode ?? 'EN',
    applyTranslationToDisplayedWord
  };
  const view = renderHook((props) => useWordTranslation(props), { initialProps: args });
  return { ...view, applyTranslationToDisplayedWord };
};

describe('useWordTranslation', () => {
  beforeEach(() => {
    translateText.mockReset();
    translateSelectionWithContext.mockReset();
  });

  test('returns the documented Use<Name>Result shape', () => {
    const { result } = renderTranslationHook();
    expect(result.current).toEqual(
      expect.objectContaining({
        translation: '',
        setTranslation: expect.any(Function),
        isTranslating: false,
        setIsTranslating: expect.any(Function),
        wordTranslationError: '',
        setWordTranslationError: expect.any(Function),
        triggerAutoTranslation: expect.any(Function),
        appendAutoTranslation: expect.any(Function),
        cancelInflight: expect.any(Function),
        clearCache: expect.any(Function)
      })
    );
  });

  test('triggerAutoTranslation returns early when text is null', async () => {
    const { result } = renderTranslationHook({ text: null });
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(translateText).not.toHaveBeenCalled();
  });

  test('triggerAutoTranslation returns early when auto-translate is disabled and not forced', async () => {
    const { result } = renderTranslationHook({
      globalSettings: { autoTranslateWords: false }
    });
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(translateText).not.toHaveBeenCalled();
  });

  test('triggerAutoTranslation fetches and stores a translation', async () => {
    translateText.mockResolvedValue({ translatedText: 'hello' });
    const { result, applyTranslationToDisplayedWord } = renderTranslationHook();
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(translateText).toHaveBeenCalledWith('hola', 'es', 'EN', expect.any(Object));
    expect(result.current.translation).toBe('hello');
    expect(applyTranslationToDisplayedWord).toHaveBeenCalledWith('hola', 'hello');
  });

  test('second trigger for the same term hits the cache (no second API call)', async () => {
    translateText.mockResolvedValue({ translatedText: 'hello' });
    const { result } = renderTranslationHook();
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(translateText).toHaveBeenCalledTimes(1);
    expect(result.current.translation).toBe('hello');
  });

  test('surfaces a clear rate-limit message on 429', async () => {
    translateText.mockRejectedValue({ status: 429, message: 'rate limit' });
    const { result } = renderTranslationHook();
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(result.current.wordTranslationError).toMatch(/rate limit/i);
  });

  test('does not surface error when the request is aborted', async () => {
    translateText.mockRejectedValue({ name: 'AbortError' });
    const { result } = renderTranslationHook();
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(result.current.wordTranslationError).toBe('');
  });

  test('appendAutoTranslation merges a new context-aware translation with the existing one', async () => {
    translateSelectionWithContext.mockResolvedValueOnce({ translatedText: 'apple' });
    const { result, applyTranslationToDisplayedWord } = renderTranslationHook();
    act(() => {
      result.current.setTranslation('fruit');
    });
    await act(async () => {
      await result.current.appendAutoTranslation('manzana', { sentenceContext: 'Una manzana roja' });
    });
    await waitFor(() => {
      expect(result.current.translation).toBe('fruit, apple');
    });
    expect(applyTranslationToDisplayedWord).toHaveBeenCalledWith('manzana', 'fruit, apple');
  });

  test('appendAutoTranslation skips duplicate context translations', async () => {
    translateSelectionWithContext.mockResolvedValueOnce({ translatedText: 'apple' });
    const { result } = renderTranslationHook();
    act(() => {
      result.current.setTranslation('apple');
    });
    await act(async () => {
      await result.current.appendAutoTranslation('manzana', { sentenceContext: 'Una manzana' });
    });
    await waitFor(() => {
      expect(result.current.translation).toBe('apple');
    });
  });

  test('cancelInflight aborts the in-flight request', async () => {
    let observedSignal = null;
    translateText.mockImplementation((_term, _src, _tgt, opts) => {
      observedSignal = opts?.signal;
      return new Promise(() => {});
    });
    const { result } = renderTranslationHook();
    act(() => {
      result.current.triggerAutoTranslation('hola');
    });
    expect(observedSignal?.aborted).toBe(false);
    act(() => {
      result.current.cancelInflight();
    });
    expect(observedSignal?.aborted).toBe(true);
  });
});
