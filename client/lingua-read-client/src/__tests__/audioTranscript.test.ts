import { describe, expect, test } from 'vitest';
import { groupTranscriptCues, transcriptCueSeparator } from '../utils/audioTranscript';

const cues = (...texts: string[]) => texts.map((text, index) => ({ id: index + 1, startTime: index * 2, endTime: index * 2 + 2, text }));

describe('transcript sentence grouping', () => {
  test('cue layout keeps each nonempty cue on its own row', () => {
    const result = groupTranscriptCues(cues('Uma história que', 'continua aqui.', '', 'Outra frase.'), 'pt', 'cues');
    expect(result.paragraphs.map(paragraph => paragraph.cues.map(cue => cue.text)))
      .toEqual([['Uma história que'], ['continua aqui.'], ['Outra frase.']]);
    expect(result.paragraphByCue).toEqual([0, 1, 1, 2]);
  });
  test('joins subtitle chunks and line breaks while retaining cue ids and row mapping', () => {
    const result = groupTranscriptCues(cues('Uma história\nque', 'continua aqui.', 'Outra frase', 'mais longa.'), 'pt');
    expect(result.paragraphs.map(paragraph => paragraph.cues.map(cue => cue.separator + cue.text).join('')))
      .toEqual(['Uma história que continua aqui.', 'Outra frase mais longa.']);
    expect(result.paragraphByCue).toEqual([0, 0, 1, 1]);
    expect(result.paragraphs.flatMap(paragraph => paragraph.cues.map(cue => cue.line.id))).toEqual([1, 2, 3, 4]);
  });
  test('does not split at an abbreviation', () => {
    expect(groupTranscriptCues(cues('Mr.', 'Smith arrived.'), 'en').paragraphByCue).toEqual([0, 0]);
  });
  test('starts another group after a pause or a long uninterrupted passage', () => {
    const lines = cues('First phrase', 'after a pause');
    lines[1].startTime = 4;
    expect(groupTranscriptCues(lines).paragraphByCue).toEqual([0, 1]);
    expect(groupTranscriptCues(cues('x'.repeat(420), 'another phrase')).paragraphByCue).toEqual([0, 1]);
  });
  test('keeps unpunctuated speech in short blocks without changing or dropping cues', () => {
    const lines = cues(...Array.from({ length: 12 }, (_, index) => `${index} ${'palavra '.repeat(8)}`));
    const result = groupTranscriptCues(lines, 'pt', 'flow', { maxCharacters: 150 });
    for (const paragraph of result.paragraphs) {
      expect(paragraph.cues.length).toBeLessThanOrEqual(3);
      expect(paragraph.cues.map(cue => cue.separator + cue.text).join('').length).toBeLessThanOrEqual(150);
    }
    expect(result.paragraphs.flatMap(paragraph => paragraph.cues.map(cue => cue.line))).toEqual(lines);
    expect(result.paragraphs.map(paragraph => paragraph.cues.map(cue => cue.separator + cue.text).join('')).join(' '))
      .toBe(lines.map(line => line.text.trim()).join(' '));
  });
  test('does not split an unusually long timed cue into artificial fragments', () => {
    const lines = cues('palavra '.repeat(50), 'another phrase');
    const result = groupTranscriptCues(lines, 'pt', 'flow', { maxCharacters: 150 });
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphs[0].cues[0].text).toBe(lines[0].text.trim());
  });
  test('handles empty cues without inserting empty visual lines', () => {
    const result = groupTranscriptCues(cues('', 'A phrase', '', 'continues.'));
    expect(result.paragraphs.flatMap(paragraph => paragraph.cues)).toHaveLength(2);
    expect(groupTranscriptCues(cues('', ' ')).paragraphs).toEqual([]);
  });
});

test.each([
  ['hello', 'world', 'en', ' '],
  ['Olá', ',', 'pt', ''],
  ['guarda-', 'chuva', 'pt', ''],
  ['l’', 'homme', 'fr', ''],
  ["He said 'hello'", 'then left', 'en', ' '],
  ['hello -', 'world', 'en', ' '],
  ['hello —', 'world', 'en', ' '],
  ['私は', '図書館で', 'ja', ''],
  ['今天', '学习中文', 'zh', ''],
  ['ฉันชอบ', 'อ่านหนังสือ', 'th', ''],
  ['hello', 'world', 'zh', ' ']
])('cue joining preserves word and punctuation spacing: %s / %s (%s)', (previous, next, code, separator) => {
  expect(transcriptCueSeparator(previous, next, code)).toBe(separator);
});
