// A "displayed/selected word" is the TextDisplay-side accumulation of fields
// from API word records plus local UI flags. Shape varies; the index signature
// uses unknown so consumers must narrow before reading extras.
import type { KoreanLemmaCandidate } from '../utils/koreanLookup';

export type DisplayedWord = {
  wordId?: number | string;
  term?: string;
  surface?: string;
  particleBadge?: string;
  lemmaCandidates?: KoreanLemmaCandidate[];
  translation?: string;
  status?: number;
  isNew?: boolean;
  [key: string]: unknown;
};
