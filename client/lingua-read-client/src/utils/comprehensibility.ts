export type ComprehensionBand =
  | 'too-hard'
  | 'challenging'
  | 'sweet-spot'
  | 'too-easy'
  | 'unknown';

export type ComprehensionInput = {
  totalWords?: number | null;
  knownWords?: number | null;
  unknownWords?: number | null;
  unknownWordPercentage?: number | null;
};

export const KRASHEN_SWEET_SPOT_MIN = 90;
export const KRASHEN_SWEET_SPOT_MAX = 98;

export function comprehensionPercent(input: ComprehensionInput): number | null {
  const total = input.totalWords;
  if (total == null || total <= 0) return null;

  if (input.knownWords != null && input.knownWords >= 0) {
    return clampPercent((input.knownWords / total) * 100);
  }

  if (input.unknownWordPercentage != null) {
    return clampPercent(100 - input.unknownWordPercentage);
  }

  if (input.unknownWords != null && input.unknownWords >= 0) {
    return clampPercent(((total - input.unknownWords) / total) * 100);
  }

  return null;
}

export function comprehensionBand(percent: number | null): ComprehensionBand {
  if (percent == null) return 'unknown';
  if (percent < 70) return 'too-hard';
  if (percent < KRASHEN_SWEET_SPOT_MIN) return 'challenging';
  if (percent <= KRASHEN_SWEET_SPOT_MAX) return 'sweet-spot';
  return 'too-easy';
}

export function bandVariant(band: ComprehensionBand): string {
  switch (band) {
    case 'too-hard': return 'danger';
    case 'challenging': return 'warning';
    case 'sweet-spot': return 'success';
    case 'too-easy': return 'secondary';
    case 'unknown': return 'light';
  }
}

export function bandLabel(band: ComprehensionBand): string {
  switch (band) {
    case 'too-hard': return 'Too hard';
    case 'challenging': return 'Challenging';
    case 'sweet-spot': return 'Just right';
    case 'too-easy': return 'Too easy';
    case 'unknown': return 'Unknown';
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
