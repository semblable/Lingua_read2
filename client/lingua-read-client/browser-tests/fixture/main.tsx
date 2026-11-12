import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.min.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/500.css';
import '@fontsource/lora/600.css';
import '@fontsource/lora/700.css';
import '../../src/index.css';
import '../../src/App.css';
import Home from '../../src/pages/Home';
import Navigation from '../../src/components/Navigation';
import { useAuthStore } from '../../src/utils/store';

// Playwright supplies a new browser context for every test. Seed this context's
// real store without bootstrapping account sessions or background offline work.
useAuthStore.setState({
  isAuthenticated: true,
  isLoading: false,
  localMode: true,
  user: { id: 'synthetic-browser-learner', username: 'Zoë' },
});

// eslint-disable-next-line react-refresh/only-export-components -- Standalone test entry point.
function RouteDestination() {
  const location = useLocation();
  return <p data-testid="route-destination">{location.pathname}{location.search}</p>;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="App">
        <p className="small text-center m-0 p-1">Browser test fixture · synthetic sample data</p>
        <Navigation />
        <div className="container-fluid p-0 m-0">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="*" element={<RouteDestination />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  </React.StrictMode>,
);
