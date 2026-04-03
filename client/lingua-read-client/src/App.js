import React, { useEffect, useContext } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from './utils/store';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import { SettingsProvider, SettingsContext } from './contexts/SettingsContext';

// Components
import Navigation from './components/Navigation';

// Pages
import Home from './pages/Home';
import Login from './pages/Login';
import Setup from './pages/Setup';
import TextList from './pages/TextList';
import TextCreate from './pages/TextCreate';
import TextDisplay from './pages/TextDisplay';
import BookList from './pages/BookList';
import BookCreate from './pages/BookCreate';
import BookDetail from './pages/BookDetail';
import Statistics from './pages/Statistics';
import UserSettings from './pages/UserSettings';
import CreateAudioLesson from './pages/CreateAudioLesson';
import LanguagesPage from './components/settings/LanguagesPage';
import BatchAudioCreate from './pages/BatchAudioCreate';
import TermsPage from './pages/TermsPage';
import SrsReview from './pages/SrsReview';
import SrsStoryReview from './pages/SrsStoryReview';
import Library from './pages/Library';

// Simple loading component
const Loading = () => <div className="d-flex justify-content-center align-items-center vh-100">Loading...</div>;

// Protected Route Component
const ProtectedRoute = ({ isAuthenticated, isLoading }) => {
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

    const applyTheme = (theme) => {
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
    const handleSystemThemeChange = (e) => {
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
      document.body.style.setProperty('--reading-line-height', settingsContext.settings.lineSpacing);
      localStorage.setItem('lineSpacing', settingsContext.settings.lineSpacing);
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

  return (
    <div className="App">
      <Navigation />
      <div className="container-fluid p-0 m-0">
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

            <Route path="/statistics" element={<Statistics />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/srs" element={<SrsReview />} />
            <Route path="/srs/story" element={<SrsStoryReview />} />

            <Route path="/settings" element={<UserSettings />} />
            <Route path="/settings/languages" element={<LanguagesPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
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