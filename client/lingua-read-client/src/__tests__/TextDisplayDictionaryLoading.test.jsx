import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TextDisplay from '../pages/TextDisplay';
import { SettingsContext } from '../contexts/SettingsContext';

const { readerState } = vi.hoisted(() => ({ readerState: {} }));
vi.mock('../hooks/useReaderState', () => ({ useReaderState: () => readerState }));
vi.mock('../hooks/useReaderBookmarks', () => ({ useReaderBookmarks: () => ({}) }));
vi.mock('../utils/bookmarkSync', () => ({ migrateLegacyBookmarks: async () => {} }));

test.each([
  ['jieba-v1', '中文词语'],
  ['thai-dict-v1', 'ภาษาไทย'],
])('reader can render loading/error states before %s dictionary initializes', (parserType, term) => {
  Object.assign(readerState, {
    loading: true, error: '', text: null, words: [{ term, status: 2 }],
    languageConfig: { parserType }, srtLines: [],
  });
  const view = render(
    <MemoryRouter>
      <SettingsContext.Provider value={{ settings: {}, updateSetting: vi.fn() }}>
        <TextDisplay />
      </SettingsContext.Provider>
    </MemoryRouter>
  );
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
  Object.assign(readerState, { loading: false, error: 'Dictionary download failed. Reconnect and reopen this text.' });
  view.rerender(
    <MemoryRouter>
      <SettingsContext.Provider value={{ settings: {}, updateSetting: vi.fn() }}>
        <TextDisplay />
      </SettingsContext.Provider>
    </MemoryRouter>
  );
  expect(screen.getByText(/Dictionary download failed/)).toBeInTheDocument();
});
