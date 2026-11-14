import { useState } from 'react';
import TranslationPopup from '../../src/components/TranslationPopup';
import ActivityHeatmap from '../../src/components/statistics/ActivityHeatmap';
import ActivityCharts from '../../src/components/statistics/ActivityCharts';
import { WORD_STATUS_LABELS, type WordStatus } from '../../src/types/wordStatus';
import '../../src/components/statistics/Statistics.css';

const reading = { totalWordsRead: 321, activityByDate: [{ date: '2026-11-12', wordsRead: 321 }], activityByLanguage: [] };
const listening = { totalListeningSeconds: 150, listeningByDate: [{ date: '2026-11-12', minutesListened: 2.5 }], listeningByLanguage: [] };
const known = { totalKnownWords: 12, knownWordsByDate: [{ date: '2026-11-12', knownWords: 12 }], knownWordsByLanguage: [] };
const sample = ['Éloïse', 'rivière', 'apprend', 'façade', 'avancée', 'connue', 'ignorée'];
const pairedTranslation = Array.from({ length: 5 }, (_, index) =>
  `<o s="${index + 1}">Éloïse découvre la rivière ${index + 1}.</o><t s="${index + 1}">Eloise discovers the river ${index + 1}.</t>`).join('');

export default function PresentationFixture() {
  const [showTranslation, setShowTranslation] = useState(false);
  return (
    <main aria-label="Accessibility presentation fixture" className="container py-3">
      <h1>Reading appearance samples</h1>
      <p>Wholly authored synthetic data. <a href="#statistics-samples">View activity values</a>.</p>
      <button className="btn btn-primary mb-3" onClick={() => setShowTranslation(true)}>Open translation sample</button>
      <figure>
        <p className="reader-paragraph" lang="fr">{sample.map((term, status) => <span key={status}>
          <span className={`clickable-word word-status-${status}`} title={WORD_STATUS_LABELS[status as WordStatus]}>{term}</span>{' '}
        </span>)}</p>
        <figcaption>Untracked, New, Learning, Familiar, Advanced, Known, Ignored.</figcaption>
      </figure>
      <section id="statistics-samples" aria-label="Statistics samples">
        <h2>Activity values</h2>
        <ActivityHeatmap readingActivity={reading} listeningActivity={listening} period="last_week" />
        <ActivityCharts displayStats={null} readingActivity={reading} listeningActivity={listening}
          knownWordsActivity={known} languages={[]} loadingActivity={false} showComparison={false} />
      </section>
      <TranslationPopup show={showTranslation} handleClose={() => setShowTranslation(false)} originalText="Éloïse découvre."
        translatedText={pairedTranslation} sourceLanguage="French" targetLanguage="English" />
    </main>
  );
}
