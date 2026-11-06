import { test, expect } from 'vitest';
import { segmentContext, findContextTarget } from '../utils/storyContext';

test.each([
  ['Today we go to school.', 'to', 'en', 12],
  ['Inside, stand in line.', 'in', 'en', 14],
  ['Und danach: das Haus.', 'das', 'de', 12],
  ['İstanbul. Go to school.', 'to', 'en', 13],
  ['我喜欢学习中文。', '学习', 'zh', 3],
])('matches complete target words in %s', (context, term, code, start) => {
  expect(findContextTarget(context, term, code)).toEqual({ start, end: start + term.length });
});

test('does not highlight a prefix when the target word is absent', () => {
  expect(findContextTarget('Today is sunny.', 'to', 'en')).toBeNull();
});

test.each([
  ['zh', '我喜欢学习中文。'],
  ['ja', '私は日本語を勉強します。'],
  ['th', 'ฉันกำลังเรียนภาษาไทย'],
])('exposes individual %s words and preserves original display text', (code, text) => {
  const tokens = segmentContext(text, code);
  expect(tokens.map(t => t.text).join('')).toBe(text);
  expect(tokens.filter(t => t.isWord).length).toBeGreaterThan(1);
});
