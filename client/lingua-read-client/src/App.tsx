import { safeLocalStorageSetItem } from './utils/storage';
import { loginReturnPath } from './utils/helpers';
import React, { useContext, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from './utils/store';
import './App.css';
import { getInitialSettings, SettingsContext } from './contexts/SettingsContext';
import { SettingsProvider } from './contexts/SettingsProvider';
import { applyReaderStatusMarkers, readCachedTheme, watchTheme } from './utils/theme';

// Components (always needed)
import Navigation from './components/Navigation';
import ErrorBoundary from './components/ErrorBoundary';
import OfflineIndicator from './components/offline/OfflineIndicator';
import { productionSyncHandlers } from './utils/offline/handlers';
import { registerServiceWorker } from './utils/offline/registerServiceWorker';
import { migrateLegacyBookmarks } from './utils/bookmarkSync';

// Pages needed on initial render (eager)
import Home from './pages/Home';
import Login from './pages/Login';
import Setup from './pages/Setup';

// Pages loaded on-demand (lazy)
const TextCreate = lazy(() => import('./pages/TextCreate'));
const TextDisplay = lazy(() => import('./pages/TextDisplay'));
const BookCreate = lazy(() => import('./pages/BookCreate'));
const BookDetail = lazy(() => import('./pages/BookDetail'));
const Statistics = lazy(() => import('./pages/Statistics'));
const UserSettings = lazy(() => import('./pages/UserSettings'));
const CreateAudioLesson = lazy(() => import('./pages/CreateAudioLesson'));
const LanguagesPage = lazy(() => import('./components/settings/LanguagesPage'));
const BatchAudioCreate = lazy(() => import('./pages/BatchAudioCreate'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const SrsReview = lazy(() => import('./pages/SrsReview'));
const SrsStoryReview = lazy(() => import('./pages/SrsStoryReview'));
const Library = lazy(() => import('./pages/Library'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Goals = lazy(() => import('./pages/Goals'));
const HomeLite = lazy(() => import('./pages/HomeLite'));

// Simple loading component
const Loading = () => <div className="d-flex justify-content-center align-items-center vh-100">Loading...</div>;

// Protected Route Component
const ProtectedRoute = ({ isAuthenticated, isLoading }: { isAuthenticated: boolean; isLoading: boolean }) => {
  if (isLoading) {
    return <Loading />;
  }
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" />;
};

// Inner component that has access to SettingsContext (only rendered when authenticated)
const AuthenticatedApp = () => {
  const location = useLocation();
  const { isAuthenticated, isLoading } = useAuthStore();
  const settingsContext = useContext(SettingsContext);

  // Bookmarks used to live only in this browser; upload them once so they sync.
  useEffect(() => {
    if (isAuthenticated) void migrateLegacyBookmarks();
  }, [isAuthenticated]);

  // Apply line spacing from settings
  useEffect(() => {
    if (settingsContext && settingsContext.settings && settingsContext.settings.lineSpacing) {
      document.body.style.setProperty('--reading-line-height', String(settingsContext.settings.lineSpacing));
      safeLocalStorageSetItem('lineSpacing', String(settingsContext.settings.lineSpacing));
    } else {
      const savedLineSpacing = localStorage.getItem('lineSpacing') || '1.5';
      document.body.style.setProperty('--reading-line-height', savedLineSpacing);
    }
  }, [settingsContext]);

  // Load initial line spacing from localStorage on mount
  useEffect(() => {
    const initialLineSpacing = localStorage.getItem('lineSpacing') || '1.5';
    document.body.style.setProperty('--reading-line-height', initialLineSpacing);
  }, []);

  // Apply paragraph spacing from settings
  useEffect(() => {
    if (settingsContext && settingsContext.settings && settingsContext.settings.paragraphSpacing) {
      document.body.style.setProperty('--reader-paragraph-spacing', settingsContext.settings.paragraphSpacing + 'em');
      safeLocalStorageSetItem('paragraphSpacing', String(settingsContext.settings.paragraphSpacing));
    } else {
      const saved = localStorage.getItem('paragraphSpacing') || '1.0';
      document.body.style.setProperty('--reader-paragraph-spacing', saved + 'em');
    }
  }, [settingsContext]);

  // Load initial paragraph spacing from localStorage on mount
  useEffect(() => {
    const initial = localStorage.getItem('paragraphSpacing') || '1.0';
    document.body.style.setProperty('--reader-paragraph-spacing', initial + 'em');
  }, []);

  return (
    <div className="App">
      <Navigation />
      <div className="position-fixed top-0 end-0 m-2" style={{ zIndex: 1080 }}>
        <OfflineIndicator handlers={productionSyncHandlers} />
      </div>
      <div className="app-route-content">
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={settingsContext.settings.minimalHome ? <HomeLite /> : <Home />} />
              <Route path="/login" element={<Navigate to={loginReturnPath(location.search)} replace />} />

              <Route element={<ProtectedRoute isAuthenticated={isAuthenticated} isLoading={isLoading} />}>
                <Route path="/library" element={<Library />} />
                <Route path="/library/:folderId" element={<Library />} />

                {/* The old book and text lists live on in the Library. */}
                <Route path="/books" element={<Navigate to="/library" replace />} />
                <Route path="/books/create" element={<BookCreate />} />
                <Route path="/books/:bookId" element={<BookDetail />} />

                <Route path="/texts" element={<Navigate to="/library" replace />} />
                <Route path="/texts/create" element={<TextCreate />} />
                <Route path="/texts/:textId" element={<TextDisplay />} />
                <Route path="/texts/create-audio" element={<CreateAudioLesson />} />
                <Route path="/texts/create-batch-audio" element={<BatchAudioCreate />} />

                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/goals" element={<Goals />} />
                <Route path="/statistics" element={<Statistics />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/srs" element={<SrsReview />} />
                <Route path="/srs/story" element={<SrsStoryReview />} />

                <Route path="/settings" element={<UserSettings />} />
                <Route path="/settings/languages" element={<LanguagesPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
};

// Top-level component: gates auth, wraps authenticated content with SettingsProvider
function App() {
  const { isAuthenticated, isLoading, needsSetup, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Register the PWA service worker once on mount. Safe in tests — the
  // wrapper silently skips when the virtual module isn't available.
  //
  // With `registerType: 'autoUpdate'` a new service worker takes over by
  // itself; the page reloads only if it is from an older build (see
  // registerServiceWorker.ts) — no manual prompt needed.
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  // Apply theme early (even before auth) so login/setup pages respect saved theme
  useEffect(() => {
    applyReaderStatusMarkers(getInitialSettings().readerStatusMarkersEnabled);
    return watchTheme(readCachedTheme);
  }, []);

  if (isLoading) {
    return <Loading />;
  }

  if (needsSetup) {
    return <Setup />;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <SettingsProvider>
      <AuthenticatedApp />
    </SettingsProvider>
  );
}

export default App;
