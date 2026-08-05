import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { pwaService } from './services/pwaService';
import { startupAudit } from './utils/startupAudit';

startupAudit.mark('app_bootstrap_start');

// Defer PWA Service Worker registration after initial render to avoid blocking startup
setTimeout(() => {
  startupAudit.mark('sw_registration_start');
  pwaService.registerServiceWorker()
    .then(() => {
      startupAudit.mark('sw_registration_end');
      startupAudit.measure('Service Worker registration', 'sw_registration_start', 'sw_registration_end');
    })
    .catch(err => console.warn('SW Register Error:', err));
}, 100);

startupAudit.mark('app_bootstrap_end');
startupAudit.measure('App bootstrap', 'app_bootstrap_start', 'app_bootstrap_end');

startupAudit.mark('react_mount_start');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
startupAudit.mark('react_mount_end');
startupAudit.measure('React mount', 'react_mount_start', 'react_mount_end');


