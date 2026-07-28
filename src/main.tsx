import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { pwaService } from './services/pwaService';

// Initialize PWA Service Worker
pwaService.registerServiceWorker().catch(err => console.warn('SW Register Error:', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

