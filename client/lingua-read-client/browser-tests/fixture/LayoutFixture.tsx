import { Route, Routes } from 'react-router-dom';
import { SettingsContext, mergeSettings } from '../../src/contexts/SettingsContext';
import BookCreate from '../../src/pages/BookCreate';
import CreateAudioLesson from '../../src/pages/CreateAudioLesson';
import Library from '../../src/pages/Library';
import TermsPage from '../../src/pages/TermsPage';
import TextDisplay from '../../src/pages/TextDisplay';

// Local settings only: no account provider, settings fetch/save, or startup sync.
const settings = mergeSettings({
  autoTranslateWords: false, autoTranslateOnOpen: false,
  readingUiMode: new URLSearchParams(window.location.search).get('mode') || 'classic',
});

export default function LayoutFixture() {
  return (
    <SettingsContext.Provider value={{
      settings, loadingSettings: false, errorSettings: null,
      updateSetting: () => { throw new Error('Layout checks must not change settings'); },
      refetchSettings: async () => {},
    }}>
      <Routes>
        <Route path="library" element={<Library />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="books/create" element={<BookCreate />} />
        <Route path="audio/create" element={<CreateAudioLesson />} />
        <Route path="texts/:textId" element={<TextDisplay />} />
      </Routes>
    </SettingsContext.Provider>
  );
}
