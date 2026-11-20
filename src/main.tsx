import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { getStoredTheme, applyThemeToDOM } from './utils/theme.ts';
import './index.css';

// Immediately synchronize theme before React renders to avoid theme flash
applyThemeToDOM(getStoredTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
