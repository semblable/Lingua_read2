import type { TextsList } from '../../utils/api/texts';
import { comprehensionBand, comprehensionPercent, KRASHEN_SWEET_SPOT_MAX, KRASHEN_SWEET_SPOT_MIN } from '../../utils/comprehensibility';

const PICKS_PER_LANGUAGE = 3;
const TARGET_PERCENT = (KRASHEN_SWEET_SPOT_MIN + KRASHEN_SWEET_SPOT_MAX) / 2;

export interface ReadingSuggestion {
  key: string;
  title: string;
  languageName: string;
  kind: 'book' | 'text' | 'audio';
  href: string;
  action: string;
  totalWords: number;
  unfamiliarWords: number;
  percent: number;
  book?: { partCount: number; remainingParts: number };
}

// Weight by word occurrences, not chapter count. Completed parts must not make
// the unread remainder look easier; missing stats must not silently disappear.
function vocabularySummary(parts: TextsList) {
  let totalWords = 0;
  let familiarWords = 0;
  for (const part of parts) {
    if (part.wordLinkingStatus != null && part.wordLinkingStatus !== 'completed') return null;
    // Linking can finish before cached counts refresh. Only the server's check
    // of the completed word links can confirm a zero-word part is safe to omit.
    if (part.totalWords === 0 && part.hasNoCountableWords) continue;
    const percent = comprehensionPercent(part);
    if (percent == null || !Number.isFinite(percent) || !Number.isFinite(part.totalWords)) return null;
    totalWords += part.totalWords!;
    familiarWords += part.knownWords != null && part.knownWords >= 0
      ? Math.min(part.totalWords!, part.knownWords)
      : part.totalWords! * percent / 100;
  }
  if (totalWords <= 0) return null;
  return {
    totalWords,
    unfamiliarWords: Math.max(0, Math.round(totalWords - familiarWords)),
    percent: familiarWords / totalWords * 100,
  };
}

export function readingSuggestions(texts: TextsList): Map<string, ReadingSuggestion[]> {
  const candidates: ReadingSuggestion[] = [];
  const books = new Map<number, TextsList>();
  for (const text of texts) {
    if (text.bookId != null) {
      const parts = books.get(text.bookId) ?? [];
      parts.push(text);
      books.set(text.bookId, parts);
      continue;
    }
    if (text.textId == null || text.isFinished) continue;
    const vocabulary = vocabularySummary([text]);
    if (!vocabulary) continue;
    candidates.push({
      key: String(text.textId), title: text.title || 'Untitled',
      languageName: text.languageName || 'Unknown', kind: text.isAudioLesson ? 'audio' : 'text',
      href: `/texts/${text.textId}`, action: text.isAudioLesson ? 'Listen to lesson' : 'Read text',
      ...vocabulary,
    });
  }

  for (const [bookId, parts] of books) {
    if (parts.some(part => part.bookIsFinished)) continue;
    const remaining = parts.filter(part => !part.isFinished);
    const vocabulary = vocabularySummary(remaining);
    if (!vocabulary) continue;

    // Reading order chooses the destination only, never the difficulty score.
    const hasOrder = remaining.every(part => part.partNumber != null && part.partNumber > 0);
    const next = hasOrder
      ? [...remaining].sort((a, b) => a.partNumber! - b.partNumber! || (a.textId ?? 0) - (b.textId ?? 0))[0]
      : undefined;
    const inProgress = remaining.length < parts.length;
    candidates.push({
      key: `book-${bookId}`, title: parts[0].bookTitle || 'Untitled book',
      languageName: parts[0].languageName || 'Unknown', kind: 'book',
      href: next?.textId != null ? `/texts/${next.textId}` : `/books/${bookId}`,
      action: next?.textId != null ? `${inProgress ? 'Continue book' : 'Start book'} · Part ${next.partNumber}` : 'View book',
      book: { partCount: parts.length, remainingParts: remaining.length },
      ...vocabulary,
    });
  }

  const grouped = new Map<string, ReadingSuggestion[]>();
  for (const candidate of candidates) {
    if (comprehensionBand(candidate.percent) !== 'sweet-spot') continue;
    const items = grouped.get(candidate.languageName) ?? [];
    items.push(candidate);
    grouped.set(candidate.languageName, items);
  }
  for (const [language, items] of grouped) {
    const sorted = [...items].sort((a, b) => Math.abs(a.percent - TARGET_PERCENT) - Math.abs(b.percent - TARGET_PERCENT));
    grouped.set(language, sorted.slice(0, PICKS_PER_LANGUAGE));
  }
  return grouped;
}
