import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
// Self-hosted fonts + icons (previously render-blocking CDN <link>s in index.html).
// Weights mirror the old Google Fonts request; Lora also ships italics for reader text.
import 'bootstrap-icons/font/bootstrap-icons.min.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/500.css';
import '@fontsource/lora/600.css';
import '@fontsource/lora/700.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/lora/500-italic.css';
import '@fontsource/lora/600-italic.css';
import '@fontsource/lora/700-italic.css';
// Selectable reader fonts (see AppearanceSettings): regular + bold + italics each.
// No CSS in the app requests other weights, so this matches what the old CDN
// import effectively delivered.
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/lato/400-italic.css';
import '@fontsource/lato/700-italic.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/merriweather/400-italic.css';
import '@fontsource/merriweather/700-italic.css';
import '@fontsource/roboto-slab/400.css';
import '@fontsource/roboto-slab/700.css';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/700.css';
import '@fontsource/open-sans/400-italic.css';
import '@fontsource/open-sans/700-italic.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/atkinson-hyperlegible/400-italic.css';
import '@fontsource/atkinson-hyperlegible/700-italic.css';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
