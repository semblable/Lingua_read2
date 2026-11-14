import { safeLocalStorageSetItem } from './storage';
import '../accessibility-themes.css';

export const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'classic-dark', label: 'Classic Dark' },
  { value: 'high-contrast-light', label: 'High Contrast Light' },
  { value: 'high-contrast-dark', label: 'High Contrast Dark' },
  { value: 'system', label: 'System Default' },
] as const;

export type ThemePreference = typeof THEME_OPTIONS[number]['value'];
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

const THEME_CLASSES = THEME_OPTIONS
  .filter(option => option.value !== 'system')
  .map(option => `${option.value}-theme`);
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

const isThemePreference = (value: unknown): value is ThemePreference =>
  THEME_OPTIONS.some(option => option.value === value);

export const normalizeTheme = (value: unknown, fallback: ThemePreference = 'dark'): ThemePreference =>
  isThemePreference(value) ? value : fallback;

export const resolveTheme = (preference: unknown, prefersDark: boolean): ResolvedTheme => {
  const theme = normalizeTheme(preference);
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
};

// Keep the standalone key compatible with older versions and with pre-auth pages.
// Older caches can lack theme or contain values from a removed experiment.
export const readCachedTheme = (): ThemePreference => {
  try {
    const stored = localStorage.getItem('theme');
    if (isThemePreference(stored)) return stored;
    const cached = JSON.parse(localStorage.getItem('cachedSettings') || '{}') as { theme?: unknown } | null;
    return normalizeTheme(cached?.theme);
  } catch {
    return 'dark';
  }
};

export const persistTheme = (preference: unknown): void => {
  safeLocalStorageSetItem('theme', normalizeTheme(preference));
};

export const applyTheme = (preference: unknown, body: HTMLElement = document.body): ResolvedTheme => {
  const prefersDark = typeof window.matchMedia === 'function' && window.matchMedia(SYSTEM_THEME_QUERY).matches;
  const theme = resolveTheme(preference, prefersDark);
  body.classList.remove(...THEME_CLASSES);
  body.classList.add(`${theme}-theme`);
  body.style.colorScheme = theme === 'light' || theme === 'high-contrast-light' ? 'light' : 'dark';
  return theme;
};

// The getter lets the app's pre-auth listener follow a preference saved after startup.
// Providers and isolated/demo entry points can use the same lifecycle without App.
export const watchTheme = (getPreference: () => unknown): (() => void) => {
  applyTheme(getPreference());
  if (typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(SYSTEM_THEME_QUERY);
  const onChange = () => {
    if (normalizeTheme(getPreference()) === 'system') applyTheme('system');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

export const applyReaderStatusMarkers = (enabled: boolean, body: HTMLElement = document.body): void => {
  body.classList.toggle('reader-status-markers', enabled === true);
};
