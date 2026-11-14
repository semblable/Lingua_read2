import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../../src/index.css';
import AppearanceSettings from '../../src/components/settings/AppearanceSettings';
import { getInitialSettings } from '../../src/contexts/SettingsContext';
import { applyReaderStatusMarkers, applyTheme } from '../../src/utils/theme';

// Direct-settings import graph: never import the reader or its lazy stylesheet.
applyTheme('light');
applyReaderStatusMarkers(true);
createRoot(document.getElementById('root')!).render(
  <main className="container"><h1>Synthetic appearance settings</h1>
    <AppearanceSettings settings={{ ...getInitialSettings(), readerStatusMarkersEnabled: true }} handleChange={() => {}} />
  </main>,
);
