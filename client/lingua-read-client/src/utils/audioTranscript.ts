import type { SrtEntry } from './srtParser';
import { hasSentenceStopBetween } from './readerText';

export type TranscriptCue = { line: SrtEntry; text: string; separator: string };
export type TranscriptParagraph = { cues: TranscriptCue[] };

// Subtitle line breaks are timing boundaries, not paragraph boundaries.
// Keep short sentence-sized groups so the active phrase is easy to follow.
export const groupTranscriptCues = (lines: SrtEntry[], languageCode?: string | null) => {
  const paragraphs: TranscriptParagraph[] = [];
  const paragraphByCue: number[] = [];
  let previous: SrtEntry | undefined;
  let length = 0;
  for (const [index, line] of lines.entries()) {
    const text = line.text.replace(/\s+/gu, ' ').trim();
    if (!text) {
      paragraphByCue[index] = Math.max(0, paragraphs.length - 1);
      continue;
    }
    const lastWord = previous?.text.match(/([\p{L}\p{M}\p{N}]+)([^\p{L}\p{M}\p{N}]*)$/u);
    const firstWord = text.match(/[\p{L}\p{M}\p{N}]+/u)?.[0];
    const sentenceEnd = lastWord && hasSentenceStopBetween(lastWord[2], { code: languageCode ?? undefined }, lastWord[1], firstWord);
    if (!paragraphs.length || (previous && (
      sentenceEnd || /[؟।॥][\p{Pe}\p{Pf}"']*\s*$/u.test(previous.text) || line.startTime - previous.endTime >= 2 || length >= 420
    ))) {
      paragraphs.push({ cues: [] });
      length = 0;
    }
    const paragraph = paragraphs[paragraphs.length - 1];
    const previousText = paragraph.cues.at(-1)?.text;
    paragraph.cues.push({ line, text, separator: previousText ? transcriptCueSeparator(previousText, text, languageCode) : '' });
    paragraphByCue[index] = paragraphs.length - 1;
    length += text.length;
    previous = line;
  }
  return { paragraphs, paragraphByCue };
};

export const transcriptCueSeparator = (previous: string, next: string, languageCode?: string | null): string => {
  if (/^[,.;:!?，。！？；：、…\])}»”’」』】]/u.test(next) || /[([{«“‘「『【¿¡]$/u.test(previous)) return '';
  const code = languageCode?.toLowerCase().split(/[-_]/u)[0];
  if (/[\p{L}\p{M}][-‐‑]$/u.test(previous) && /^[\p{L}\p{M}]/u.test(next)) return '';
  // Only known elision prefixes continue across an apostrophe; a closing quote
  // at a cue boundary must not accidentally join two separate words.
  if (code && ['fr', 'it', 'ca', 'oc'].includes(code)
    && /(?:^|\s)(?:[cdjlmnst]|qu|un|all|dall|nell)['’ʼ]$/iu.test(previous) && /^[\p{L}\p{M}]/u.test(next)) return '';
  if (code === 'th' && /\p{Script=Thai}$/u.test(previous) && /^\p{Script=Thai}/u.test(next)) return '';
  if ((code === 'zh' || code === 'ja') && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？、]$/u.test(previous)
    && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(next)) return '';
  return ' ';
};
