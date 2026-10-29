import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { tokenizeContent, normalizeTokenizerInput, lowercaseLookupTerm } from '../../client/lingua-read-client/src/utils/readerText.ts';

const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const config = code => ({ code, wordCharacters: String.raw`\p{L}\p{M}\u200C\u200D` });
const current = (text, code) => {
  const { processed, tokens } = tokenizeContent(text, config(code));
  return { processed, words: tokens.filter(t => t.type === 'word'), keys: tokens.filter(t => t.type === 'word').map(t => lowercaseLookupTerm(t.text, code)) };
};
const segment = (text, code) => [...new Intl.Segmenter(code, { granularity: 'word' }).segment(text)].map(s => ({ text: s.segment, start: s.index, end: s.index + s.segment.length, isWord: s.isWordLike }));
const initialMemory = process.memoryUsage();
const initialization = performance.now();
segment(cases.segmentation[0].text, cases.segmentation[0].code);
const coldInitializationMs = performance.now() - initialization;
const identity = cases.identity.map(c => ({ id: c.id, code: c.code, keys: c.forms.map(f => lowercaseLookupTerm(normalizeTokenizerInput(f).trim(), c.code)), tokenizations: c.forms.map(f => current(f, c.code)) }));
const segmentation = cases.segmentation.map(c => {
  const spans = segment(c.text, c.code);
  if (spans.map(s => s.text).join('') !== c.text || spans.some(s => c.text.slice(s.start, s.end) !== s.text)) throw new Error(`Invalid spans: ${c.id}`);
  return { id: c.id, code: c.code, current: current(c.text, c.code), intl: spans, matchesProvisionalWords: JSON.stringify(spans.filter(s => s.isWord).map(s => s.text)) === JSON.stringify(c.candidateWords) };
});
const timings = [];
for (const code of ['zh', 'ja', 'th']) {
  const sample = cases.segmentation.find(c => c.code === code).text;
  for (const size of [10_000, 100_000]) {
    const text = sample.repeat(Math.ceil(size / sample.length)).slice(0, size);
    let start = performance.now();
    const tokens = current(text, code);
    const currentMs = performance.now() - start;
    start = performance.now();
    const spans = segment(text, code);
    timings.push({ code, utf16Length: size, currentMs, intlMs: performance.now() - start, currentWords: tokens.words.length, intlWords: spans.filter(s => s.isWord).length });
  }
}
console.log(JSON.stringify({ runtime: process.version, icu: process.versions.icu, source: fileURLToPath(import.meta.url), initialMemory, coldInitializationMs, identity, segmentation, timings, memory: process.memoryUsage() }, null, 2));
