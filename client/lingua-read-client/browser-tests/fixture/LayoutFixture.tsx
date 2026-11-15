import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { SettingsContext, mergeSettings } from '../../src/contexts/SettingsContext';
import BookCreate from '../../src/pages/BookCreate';
import CreateAudioLesson from '../../src/pages/CreateAudioLesson';
import Library from '../../src/pages/Library';
import TermsPage from '../../src/pages/TermsPage';
import TextDisplay from '../../src/pages/TextDisplay';
import PresentationFixture from './PresentationFixture';
import SentenceLayoutFixture from './SentenceLayoutFixture';

// Local settings only: no account provider, settings fetch/save, or startup sync.
const settings = mergeSettings({
  autoTranslateWords: false, autoTranslateOnOpen: false,
  readingUiMode: new URLSearchParams(window.location.search).get('mode') || 'classic',
  sentenceMode: new URLSearchParams(window.location.search).get('sentence') === '1',
});

export default function LayoutFixture() {
  const interactiveReader = new URLSearchParams(window.location.search).get('redesign') === '1';
  const [readerSettings, setReaderSettings] = useState(settings);
  return (
    <SettingsContext.Provider value={{
      settings: readerSettings, loadingSettings: false, errorSettings: null,
      updateSetting: (key, value) => {
        if (!interactiveReader) throw new Error('Layout checks must not change settings');
        setReaderSettings(current => ({ ...current, [key]: value }));
      },
      refetchSettings: async () => {},
    }}>
      <Routes>
        <Route path="presentation" element={<PresentationFixture />} />
        <Route path="library" element={<Library />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="books/create" element={<BookCreate />} />
        <Route path="audio/create" element={<CreateAudioLesson />} />
        <Route path="texts/:textId" element={readerSettings.sentenceMode && !interactiveReader ? <SentenceLayoutFixture settings={readerSettings} /> : <TextDisplay />} />
      </Routes>
    </SettingsContext.Provider>
  );
}
