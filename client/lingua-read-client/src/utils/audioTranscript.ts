import type { SrtEntry } from './srtParser';
import { hasSentenceStopBetween } from './readerText';
import storage from './storage';

export type TranscriptCue = { line: SrtEntry; text: string; separator: string };
export type TranscriptParagraph = { cues: TranscriptCue[] };
export type TranscriptLayout = 'cues' | 'flow';
export const AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY = 'linguaReadAudioTranscriptLayout';
export const AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY = 'linguaReadAudioTranscriptAlignment';
export type TranscriptAlignment = 'left' | 'center' | 'justify';
export type TranscriptAlignments = Record<TranscriptLayout, TranscriptAlignment>;

export const readTranscriptAlignments = (): TranscriptAlignments => {
  const defaults: TranscriptAlignments = { cues: 'center', flow: 'left' };
  try {
    const saved: unknown = JSON.parse(storage.getItem(AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
    const value = saved as Record<string, unknown>;
    const valid = (candidate: unknown): candidate is TranscriptAlignment =>
      candidate === 'left' || candidate === 'center' || candidate === 'justify';
    return { cues: valid(value.cues) ? value.cues : defaults.cues, flow: valid(value.flow) ? value.flow : defaults.flow };
  } catch {
    return defaults;
  }
};
type FlowLimits = { maxCharacters?: number; maxCues?: number };

// Subtitle line breaks are timing boundaries, not paragraph boundaries.
// Flow groups several sentences into compact paragraphs; timed cues stay intact.
export const groupTranscriptCues = (
  lines: SrtEntry[], languageCode?: string | null, layout: TranscriptLayout = 'flow',
  { maxCharacters = 420, maxCues = 8 }: FlowLimits = {}
) => {
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
    const currentParagraph = paragraphs.at(-1);
    const previousText = currentParagraph?.cues.at(-1)?.text;
    const separator = previousText ? transcriptCueSeparator(previousText, text, languageCode) : '';
    const limitReached = currentParagraph && (
      currentParagraph.cues.length >= maxCues || length + separator.length + text.length > maxCharacters
    );
    const sentenceBoundary = sentenceEnd || (previous && /[؟।॥][\p{Pe}\p{Pf}"']*\s*$/u.test(previous.text));
    const paragraphReady = length >= maxCharacters * 0.55 || (currentParagraph?.cues.length ?? 0) >= 4;
    if (!paragraphs.length || layout === 'cues' || (previous && (
      (sentenceBoundary && paragraphReady) || line.startTime - previous.endTime >= 2 || limitReached
    ))) {
      paragraphs.push({ cues: [] });
      length = 0;
    }
    const paragraph = paragraphs[paragraphs.length - 1];
    const joinedSeparator = paragraph.cues.length ? separator : '';
    paragraph.cues.push({ line, text, separator: joinedSeparator });
    paragraphByCue[index] = paragraphs.length - 1;
    length += joinedSeparator.length + text.length;
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
