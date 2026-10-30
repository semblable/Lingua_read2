import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { initializeChineseSegmentation } from '../utils/chineseRuntime';
import { tokenizeContent, prepareLanguageContext, consumeWordAt, splitSentenceAroundTerm } from '../utils/readerText';

const dictionary = readFileSync(resolve(process.cwd(), '../../server/LinguaReadApi/Resources/Segmentation/jieba-big-v1.txt'), 'utf8');
initializeChineseSegmentation(dictionary);
const chinese = { parserType: 'jieba-v1', code: 'zh' };

afterEach(() => vi.unstubAllGlobals());

describe('Chinese reader token integration', () => {
  test('new profile has real spans, legacy keeps its word boundaries', () => {
    const text = '🙂我今天在图书馆学习中文。OpenAI2026';
    const result = tokenizeContent(text, chinese);
    expect(result.tokens.map(token => token.text).join('')).toBe(text);
    expect(result.tokens.filter(token => token.type === 'word').map(token => token.text))
      .toEqual(['我', '今天', '在', '图书馆', '学习', '中文', 'OpenAI']);
    expect(result.tokens[0]).toEqual({ type: 'separator', text: '🙂', start: 0, end: 2 });
    expect(tokenizeContent('图书馆学习中文', { parserType: 'jieba' }).tokens).toHaveLength(1);
    const context = prepareLanguageContext('图书馆学习中文', chinese);
    expect(consumeWordAt(context.processed, 0, context.coreRegex, context.wordEnds)?.text).toBe('图书馆');
    const partial = consumeWordAt(context.processed, 1, context.coreRegex, context.wordEnds)!;
    expect(partial.end).toBeGreaterThan(1);
    expect(partial.text).toBe(context.processed.slice(1, partial.end));
  });

  test.each(['', '   ', 'z-a'])('custom word class %s stays consistent with the legacy fallback', wordCharacters => {
    const result = tokenizeContent('中文 ABC 2026', { ...chinese, wordCharacters });
    expect(result.tokens.filter(token => token.type === 'word').map(token => token.text)).toEqual(['中文', 'ABC']);
  });

  test('Korean sentence highlighting uses raw source spans without changing spelling', () => {
    const sentence = '🙂한글 테스트.';
    const parts = splitSentenceAroundTerm(sentence, '한글', null, 'ko-KR');
    expect(parts.map(part => part.text).join('')).toBe(sentence);
    expect(parts.filter(part => part.isTerm).map(part => part.text)).toEqual(['한글']);
    expect(splitSentenceAroundTerm(sentence, '한글', null, 'en').some(part => part.isTerm)).toBe(false);
  });
});

describe('pinned Chinese dictionary offline loader', () => {
  const setup = async (cached?: string) => {
    vi.resetModules();
    vi.stubGlobal('crypto', webcrypto);
    let response = cached == null ? undefined : new Response(cached);
    const store = {
      match: vi.fn(async () => response?.clone()),
      put: vi.fn(async (_url: string, value: Response) => { response = value.clone(); }),
      delete: vi.fn(async () => { response = undefined; return true; })
    };
    vi.stubGlobal('caches', { open: vi.fn(async () => store) });
    const fetch = vi.fn(async () => new Response(dictionary));
    vi.stubGlobal('fetch', fetch);
    const { ensureChineseSegmentation } = await import('../utils/chineseDictionary');
    return { ensureChineseSegmentation, store, fetch };
  };

  test('verifies and caches once, then reopens offline using the same data', async () => {
    const first = await setup();
    await Promise.all([first.ensureChineseSegmentation(), first.ensureChineseSegmentation()]);
    expect(first.fetch).toHaveBeenCalledTimes(1);
    expect(first.store.put).toHaveBeenCalledTimes(1);
    const offline = await setup(dictionary);
    offline.fetch.mockRejectedValue(new TypeError('offline'));
    await offline.ensureChineseSegmentation();
    expect(offline.fetch).not.toHaveBeenCalled();
  });

  test('replaces corrupt cached data; does not accept or cache wrong-version downloads', async () => {
    const corrupt = await setup('not the pinned dictionary');
    await corrupt.ensureChineseSegmentation();
    expect(corrupt.store.delete).toHaveBeenCalledOnce();
    expect(corrupt.fetch).toHaveBeenCalledOnce();
    const wrong = await setup();
    wrong.fetch.mockResolvedValue(new Response('wrong data'));
    await expect(wrong.ensureChineseSegmentation()).rejects.toThrow('version mismatch');
    expect(wrong.store.put).not.toHaveBeenCalled();
    wrong.fetch.mockResolvedValue(new Response(dictionary));
    await expect(wrong.ensureChineseSegmentation()).resolves.toBeUndefined();
  });
});
