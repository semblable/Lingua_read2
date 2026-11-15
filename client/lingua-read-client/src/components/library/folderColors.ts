export type FolderColor = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal' | 'pink' | 'yellow';

export const DEFAULT_FOLDER_COLOR = '#6c757d';

export const FOLDER_COLORS: Record<FolderColor, string> = {
  blue: '#4A90D9',
  green: '#5CB85C',
  orange: '#F0AD4E',
  red: '#D9534F',
  purple: '#9B59B6',
  teal: '#1ABC9C',
  pink: '#E91E63',
  yellow: '#F1C40F'
};

/** Resolves a stored folder color key or custom CSS value to its display color. */
export const resolveFolderColor = (color?: string | null): string => {
  if (!color) return DEFAULT_FOLDER_COLOR;
  return FOLDER_COLORS[color as FolderColor] || color;
};
