export type WordStatus = 1 | 2 | 3 | 4 | 5;

export const WORD_STATUS_VALUES: readonly WordStatus[] = [1, 2, 3, 4, 5] as const;

export const WORD_STATUS_LABELS: Record<WordStatus, string> = {
  1: 'New',
  2: 'Learning',
  3: 'Familiar',
  4: 'Advanced',
  5: 'Known'
};

export const WORD_STATUS_VARIANTS: Record<WordStatus, string> = {
  1: 'danger',
  2: 'warning',
  3: 'info',
  4: 'primary',
  5: 'success'
};
