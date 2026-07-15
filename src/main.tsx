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

const isPreviewDeployment =
  window.location.hostname.endsWith('.vercel.app') &&
  !window.location.hostname.startsWith('logchecker');

if (import.meta.env.PROD && isPreviewDeployment && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister());
  });

  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys.forEach((key) => void caches.delete(key));
    });
  }
}

if (import.meta.env.PROD && !isPreviewDeployment && 'serviceWorker' in navigator) {
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
    void (async () => {
      let reloading = false;
      const reloadFresh = async () => {
        if (reloading) return;
        reloading = true;

        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.filter((key) => key.startsWith('logchecker-')).map((key) => caches.delete(key)));
        }

        window.location.reload();
      };

      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));

      const nextWorker = waitingWorker || registrations.find((registration) => registration.waiting)?.waiting;
      if (!nextWorker) {
        await reloadFresh();
        return;
      }

      navigator.serviceWorker.addEventListener('controllerchange', () => void reloadFresh(), { once: true });
      nextWorker.postMessage({ type: 'SKIP_WAITING' });
      window.setTimeout(() => void reloadFresh(), 2500);
    })();
  });
}
