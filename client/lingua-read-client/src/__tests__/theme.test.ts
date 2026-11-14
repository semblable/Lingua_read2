import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyReaderStatusMarkers, applyTheme, normalizeTheme, readCachedTheme,
  resolveTheme, THEME_OPTIONS, watchTheme,
} from '../utils/theme';
import { getInitialSettings, mergeSettings } from '../contexts/SettingsContext';

describe('theme and cached accessibility preferences', () => {
  let prefersDark = false;
  let listeners: Set<() => void>;

  beforeEach(() => {
    localStorage.clear();
    document.body.className = 'reader-modern reader-status-markers custom-state';
    listeners = new Set();
    prefersDark = false;
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: prefersDark, media: query, onchange: null,
      addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener as () => void),
      removeEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener as () => void),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    } as MediaQueryList));
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(THEME_OPTIONS)('applies $label through one resolver, preserving non-theme classes', ({ value }) => {
    document.body.classList.add('classic-dark-theme', 'high-contrast-light-theme');
    const resolved = applyTheme(value);
    expect(resolved).toBe(value === 'system' ? 'light' : value);
    expect(document.body.classList.contains(`${resolved}-theme`)).toBe(true);
    expect([...document.body.classList].filter(name => name.endsWith('-theme'))).toEqual([`${resolved}-theme`]);
    expect(document.body.classList.contains('reader-modern')).toBe(true);
    expect(document.body.classList.contains('custom-state')).toBe(true);
    expect(document.body.classList.contains('reader-status-markers')).toBe(true);
  });

  it('follows live system changes before authentication and after settings change', () => {
    localStorage.setItem('theme', 'system');
    const stop = watchTheme(readCachedTheme);
    expect(document.body.classList.contains('light-theme')).toBe(true);
    prefersDark = true;
    listeners.forEach(listener => listener());
    expect(document.body.classList.contains('dark-theme')).toBe(true);

    localStorage.setItem('theme', 'high-contrast-light');
    applyTheme(readCachedTheme());
    prefersDark = false;
    listeners.forEach(listener => listener());
    expect(document.body.classList.contains('high-contrast-light-theme')).toBe(true);
    stop();
    expect(listeners.size).toBe(0);
  });

  it('retains existing defaults and safely normalizes missing, old and malformed cache fields', () => {
    expect(getInitialSettings().theme).toBe('dark');
    expect(getInitialSettings().readerCharacterShortcutsEnabled).toBe(true);
    expect(getInitialSettings().readerStatusMarkersEnabled).toBe(false);
    localStorage.setItem('cachedSettings', JSON.stringify({ theme: 'removed-theme', readerCharacterShortcutsEnabled: 'false', readerStatusMarkersEnabled: null }));
    expect(getInitialSettings().theme).toBe('dark');
    expect(getInitialSettings().readerCharacterShortcutsEnabled).toBe(true);
    expect(getInitialSettings().readerStatusMarkersEnabled).toBe(false);
    localStorage.setItem('theme', 'light');
    expect(getInitialSettings().theme).toBe('light');
    localStorage.setItem('cachedSettings', '{');
    expect(readCachedTheme()).toBe('light');
    expect(normalizeTheme(null)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
  });

  it('retains explicit false through merge/reload and keeps markers independent of themes', () => {
    const settings = mergeSettings({ theme: 'high-contrast-dark', readerCharacterShortcutsEnabled: false, readerStatusMarkersEnabled: true });
    localStorage.setItem('cachedSettings', JSON.stringify(settings));
    expect(getInitialSettings().readerCharacterShortcutsEnabled).toBe(false);
    expect(getInitialSettings().readerStatusMarkersEnabled).toBe(true);
    applyReaderStatusMarkers(false);
    applyTheme('high-contrast-dark');
    expect(document.body.classList.contains('reader-status-markers')).toBe(false);
    applyReaderStatusMarkers(true);
    applyTheme('light');
    expect(document.body.classList.contains('reader-status-markers')).toBe(true);
  });
});
