import '@testing-library/jest-dom';

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null as ((this: MediaQueryList, ev: MediaQueryListEvent) => void) | null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  });
}

// happy-dom has no window.confirm. Tests stub it with vi.spyOn(window, 'confirm'),
// which Vitest 4+ refuses to do on a missing method, so give them one to spy on.
// Unstubbed, it answers "Cancel", like a headless browser dismissing the dialog.
if (!window.confirm) {
  Object.defineProperty(window, 'confirm', {
    writable: true,
    configurable: true,
    value: () => false
  });
}
