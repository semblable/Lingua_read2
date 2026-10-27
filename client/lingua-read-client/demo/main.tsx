import React, { Suspense, lazy, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.min.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/500.css';
import '@fontsource/lora/600.css';
import '@fontsource/lora/400-italic.css';
import '../src/index.css';
import '../src/App.css';
import { SettingsProvider } from '../src/contexts/SettingsProvider';
import { SettingsContext } from '../src/contexts/SettingsContext';
import { DEMO_CHANGE_EVENT, installDemoBackend } from './backend';
import './showcase.css';

const TextDisplay = lazy(() => import('../src/pages/TextDisplay'));
const repository = 'https://github.com/semblable/Lingua_read2';
const backend = installDemoBackend(import.meta.env.BASE_URL);

function Mark() {
  return <span className="showcase-mark" aria-hidden="true">L<span>r</span></span>;
}

function Showcase() {
  const [sample, setSample] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const readerUrl = `${import.meta.env.BASE_URL}#/reader/${sample}`;
  const goToDemo = () => document.getElementById('try-reader')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  useEffect(() => { document.body.className = 'light-theme showcase-body'; }, []);

  return <div className="showcase">
    <header className="showcase-nav showcase-width">
      <a className="showcase-brand" href={import.meta.env.BASE_URL}><Mark />LinguaRead</a>
      <nav aria-label="Main navigation">
        <button type="button" onClick={goToDemo}>Try the reader</button>
        <a href={`${repository}#installation-docker`}>Self-host</a>
        <a className="showcase-source-link" href={repository}>GitHub <span aria-hidden="true">↗</span></a>
      </nav>
    </header>

    <main>
      <section className="showcase-hero showcase-width">
        <div>
          <p className="showcase-eyebrow"><span /> OPEN SOURCE. YOUR OWN LIBRARY.</p>
          <h1>Your reading.<br />Your words.<br /><em>Your way.</em></h1>
          <p className="showcase-intro">Learn a language through the things you actually want to read. Bring your books, listen along, and keep the words you discover.</p>
          <div className="showcase-actions">
            <button className="showcase-button" type="button" onClick={goToDemo}>Open the interactive demo <span aria-hidden="true">↓</span></button>
            <a className="showcase-text-link" href={`${repository}#installation-docker`}>Run it yourself <span aria-hidden="true">↗</span></a>
          </div>
          <p className="showcase-fineprint">Self-hosted · MIT licensed · Optional AI providers</p>
        </div>
        <div className="showcase-book" aria-label="A preview of color-coded vocabulary in a Spanish story" lang="es">
          <div className="showcase-book-top"><span>FROM YOUR LIBRARY</span><span>01 / ES</span></div>
          <span className="showcase-book-number" aria-hidden="true">01</span>
          <h2>Un momento<br />de calma.</h2>
          <p>Clara camina junto al <mark>río</mark> antes de ir al trabajo. El aire está fresco y las calles todavía están <mark className="showcase-learning">tranquilas.</mark></p>
          <div className="showcase-annotation"><span>río</span><span>river</span><span>↗ A word worth keeping.</span></div>
          <div className="showcase-book-bottom"><span>A SMALL DAILY DISCOVERY</span><span aria-hidden="true">↗</span></div>
        </div>
      </section>

      <section className="showcase-demo-section" id="try-reader" aria-labelledby="demo-title">
        <div className="showcase-width">
          <div className="showcase-section-heading">
            <div><p className="showcase-eyebrow">LESS EXPLAINING. MORE EXPLORING.</p><h2 id="demo-title">Take a page for a spin.</h2></div>
            <p>This is the app’s real reader. Click a word, change its status, or switch to the listening sample.</p>
          </div>
          <div className="showcase-demo-toolbar">
            <div className="showcase-tabs" role="group" aria-label="Sample lesson">
              <button type="button" className={sample === 1 ? 'is-active' : ''} aria-pressed={sample === 1} onClick={() => setSample(1)}>01 <span>Read in Spanish</span></button>
              <button type="button" className={sample === 2 ? 'is-active' : ''} aria-pressed={sample === 2} onClick={() => setSample(2)}>02 <span>Listen in English</span></button>
            </div>
            <div className="showcase-demo-tools">
              <button type="button" onClick={() => setResetKey(k => k + 1)}>Reset sample</button>
              <a href={readerUrl} target="_blank" rel="noreferrer">Open full screen ↗</a>
            </div>
          </div>
          <div className="showcase-demo-frame">
            <iframe key={`${sample}-${resetKey}`} src={`${readerUrl}?embedded=1&reset=${resetKey}`} title={sample === 1 ? 'Interactive Spanish reader sample' : 'Interactive synchronized English audio lesson'} loading="lazy" />
          </div>
          <div className="showcase-demo-note">
            <p><strong>A small, self-contained sample.</strong> Translations and explanations are prepared in advance. Word changes and saved sentences stay in the demo tab and reset on reload. No account or API key is needed.</p>
            {sample === 1 ? <p>Try “río”, select a phrase, or open the lesson controls to explore sentence mode.</p> : <p>Human recording: <em>The North Wind and the Sun</em>, © International Phonetic Association / P. Roach, <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>. <a href="https://commons.wikimedia.org/wiki/File:Recording_of_speaker_of_British_English_(Received_Pronunciation).ogg">Source</a> · <a href={`${import.meta.env.BASE_URL}audio/ATTRIBUTION.txt`}>Caption credits & changes</a></p>}
          </div>
        </div>
      </section>

      <section className="showcase-workflow showcase-width" aria-labelledby="workflow-title">
        <p className="showcase-eyebrow">THE COMPLETE APP</p>
        <h2 id="workflow-title">A reading habit.<br />A growing vocabulary.</h2>
        <div className="showcase-workflow-grid">
          <article><span className="showcase-step">01 / BRING YOUR MATERIAL</span><h3>Your interests set the course.</h3><p>Import EPUBs, text, news feeds, or audio with subtitles. Organize books into lessons and pick up where you left off.</p><span className="showcase-detail">Books · Articles · Audio lessons</span></article>
          <article><span className="showcase-step">02 / NOTICE WHAT MATTERS</span><h3>Stay with the story.</h3><p>Look up a word or phrase, track how well you know it, and keep a useful sentence. Adjust the reader to how you like to read.</p><span className="showcase-detail">Vocabulary · Sentence mode · Bookmarks</span></article>
          <article><span className="showcase-step">03 / MAKE IT FAMILIAR</span><h3>Meet your words again.</h3><p>The full app connects mined sentences and word statuses to FSRS-6 review. Choose your retention target and review in context.</p><span className="showcase-detail">FSRS · Cloze cards · Reading credit</span></article>
        </div>
        <p className="showcase-scope-note">The static demo shows reading, cue-based playback, and local vocabulary interactions. Imports, live AI, accounts, offline synchronization, and FSRS scheduling run in the self-hosted app.</p>
      </section>

      <section className="showcase-own-section">
        <div className="showcase-width showcase-own-grid">
          <div><p className="showcase-eyebrow">A PERSONAL WORKSPACE, ON YOUR SERVER</p><h2>Keep the library.<br />Choose the tools.</h2><p>Run LinguaRead with Docker. Choose translation services and AI models that suit you, including compatible local endpoints. Back up your data and export your vocabulary.</p><a className="showcase-button" href={`${repository}#installation-docker`}>Read the installation guide ↗</a></div>
          <dl><div><dt>Deploy</dt><dd>React + TypeScript<br />ASP.NET Core + PostgreSQL<br />Docker Compose</dd></div><div><dt>Make it yours</dt><dd>Reading layout and typography<br />Configurable review settings<br />Per-task AI models and prompts</dd></div><div><dt>Real-world note</dt><dd>The maintainer reports personal use on an Oracle Cloud free-tier micro instance with swap enabled. This is an individual setup, not a capacity benchmark.</dd></div></dl>
        </div>
      </section>
      <section className="showcase-contribute showcase-width"><div><p className="showcase-eyebrow">BUILT IN THE OPEN</p><h2>Help shape the next chapter.</h2><p>Try a language you study. Share a rough edge. Improve a translation, a test, or a piece of documentation.</p></div><a className="showcase-text-link" href={`${repository}/issues`}>Explore the project on GitHub ↗</a></section>
    </main>
    <footer className="showcase-footer showcase-width"><a className="showcase-brand" href={import.meta.env.BASE_URL}><Mark />LinguaRead</a><span>Read. Notice. Remember.</span><a href={`${repository}#license`}>Source & license ↗</a></footer>
  </div>;
}

function ReaderControls({ reset }: { reset: () => void }) {
  const { textId } = useParams();
  const { settings, updateSetting } = useContext(SettingsContext);
  const [saved, setSaved] = useState(backend.snapshot().mined);
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    const update = () => setSaved(backend.snapshot().mined);
    window.addEventListener(DEMO_CHANGE_EVENT, update);
    return () => window.removeEventListener(DEMO_CHANGE_EVENT, update);
  }, []);
  useEffect(() => {
    document.body.classList.toggle('dark-theme', settings.theme === 'dark');
    document.body.classList.toggle('light-theme', settings.theme !== 'dark');
    document.body.classList.add('demo-reader-body');
  }, [settings.theme]);
  return <>
    <div className="demo-reader-notice">
      <span><a href={import.meta.env.BASE_URL} target="_top">← Samples</a><span className="demo-notice-detail"> · Prepared translations · Changes stay in this tab</span></span>
      <div>{textId === '2' && <a href={`${import.meta.env.BASE_URL}audio/ATTRIBUTION.txt`} target="_blank" rel="noreferrer">Audio credits</a>}<button type="button" onClick={() => setShowSaved(v => !v)}>Saved sentences ({saved.length})</button><button type="button" onClick={() => updateSetting('theme', settings.theme === 'dark' ? 'light' : 'dark')}>{settings.theme === 'dark' ? 'Light' : 'Dark'}</button><button type="button" onClick={reset}>Reset</button></div>
    </div>
    {showSaved && <aside className="demo-saved-sentences" aria-label="Saved sample sentences"><strong>Sentences you mined in this demo</strong>{saved.length ? saved.map((item, i) => <p key={i}>{item.sentence}</p>) : <p>Click a word, then use <em>Mine sentence</em> in its panel.</p>}<small>In the full app these can feed your FSRS review. Scheduling is not simulated here.</small></aside>}
  </>;
}

function DemoReader() {
  const { textId } = useParams();
  const [version, setVersion] = useState(0);
  return <SettingsProvider>
    <ReaderControls reset={() => { backend.reset(); setVersion(v => v + 1); }} />
    <Suspense fallback={<p className="demo-loading" role="status">Opening the reader…</p>}><TextDisplay key={`${textId}-${version}`} /></Suspense>
  </SettingsProvider>;
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Demo root is missing.');
createRoot(rootElement).render(<React.StrictMode><HashRouter><Routes>
  <Route path="/" element={<Showcase />} />
  <Route path="/reader/:textId" element={<DemoReader />} />
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes></HashRouter></React.StrictMode>);
