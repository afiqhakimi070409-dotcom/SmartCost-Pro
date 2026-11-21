import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { getStoredTheme, applyThemeToDOM } from './utils/theme.ts';
import { getStoredLanguage, applyLanguageToDOM } from './utils/i18n.ts';
import './index.css';

// Immediately synchronize theme and language before React renders to avoid flash
applyThemeToDOM(getStoredTheme());
applyLanguageToDOM(getStoredLanguage());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
