import React, { useEffect, useContext, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from './utils/store';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import { SettingsProvider, SettingsContext } from './contexts/SettingsContext';

// Components (always needed)
import Navigation from './components/Navigation';
import OfflineIndicator from './components/offline/OfflineIndicator';
import { productionSyncHandlers } from './utils/offline/handlers';
import { registerServiceWorker } from './utils/offline/registerServiceWorker';

// Pages needed on initial render (eager)
import Home from './pages/Home';
import Login from './pages/Login';
import Setup from './pages/Setup';

// Pages loaded on-demand (lazy)
const TextList = lazy(() => import('./pages/TextList'));
const TextCreate = lazy(() => import('./pages/TextCreate'));
const TextDisplay = lazy(() => import('./pages/TextDisplay'));
const BookList = lazy(() => import('./pages/BookList'));
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
  const { isAuthenticated, isLoading } = useAuthStore();
  const settingsContext = useContext(SettingsContext);

  // Theme management
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';

    const applyTheme = (theme: string) => {
      document.body.classList.remove('light-theme', 'dark-theme', 'classic-dark-theme');

      if (theme === 'dark') {
        document.body.classList.add('dark-theme');
      } else if (theme === 'light') {
        document.body.classList.add('light-theme');
      } else if (theme === 'classic-dark') {
        document.body.classList.add('classic-dark-theme');
      } else {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
          document.body.classList.add('dark-theme');
        } else {
          document.body.classList.add('light-theme');
        }
      }
    };

    applyTheme(savedTheme);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (_e: MediaQueryListEvent) => {
      if (localStorage.getItem('theme') === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);

    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, []);

  // Apply line spacing from settings
  useEffect(() => {
    if (settingsContext && settingsContext.settings && settingsContext.settings.lineSpacing) {
      document.body.style.setProperty('--reading-line-height', String(settingsContext.settings.lineSpacing));
      localStorage.setItem('lineSpacing', String(settingsContext.settings.lineSpacing));
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
      localStorage.setItem('paragraphSpacing', String(settingsContext.settings.paragraphSpacing));
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
      <div className="container-fluid p-0 m-0">
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Navigate to="/" />} />

            <Route element={<ProtectedRoute isAuthenticated={isAuthenticated} isLoading={isLoading} />}>
              <Route path="/library" element={<Library />} />
              <Route path="/library/:folderId" element={<Library />} />

              <Route path="/books" element={<BookList />} />
              <Route path="/books/create" element={<BookCreate />} />
              <Route path="/books/:bookId" element={<BookDetail />} />

              <Route path="/texts" element={<TextList />} />
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
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  // Apply theme early (even before auth) so login/setup pages respect saved theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.classList.remove('light-theme', 'dark-theme', 'classic-dark-theme');
    if (savedTheme === 'light') document.body.classList.add('light-theme');
    else if (savedTheme === 'classic-dark') document.body.classList.add('classic-dark-theme');
    else document.body.classList.add('dark-theme');
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