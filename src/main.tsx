import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

let waitingWorker: ServiceWorker | null = null;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister());
  });

  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys.forEach((key) => void caches.delete(key));
    });
  }
}

const isNetlifyPreview = window.location.hostname.endsWith('.netlify.app');

if (import.meta.env.PROD && isNetlifyPreview && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister());
  });

  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys.forEach((key) => void caches.delete(key));
    });
  }
}

if (import.meta.env.PROD && !isNetlifyPreview && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        const notifyUpdate = (worker: ServiceWorker) => {
          waitingWorker = worker;
          window.dispatchEvent(new CustomEvent('logchecker-update-ready'));
        };

        if (registration.waiting) {
          notifyUpdate(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker) {
            return;
          }

          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              notifyUpdate(installingWorker);
            }
          });
        });

        registration.update().catch(() => undefined);
      })
      .catch(() => undefined);

  });

  window.addEventListener('logchecker-apply-update', () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      window.setTimeout(() => window.location.reload(), 250);
    } else {
      window.location.reload();
    }
  });
}
