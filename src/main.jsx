import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App, { StartupErrorBoundary } from './App.jsx';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

function showStartupError(error) {
  const root = document.getElementById('root');
  if (!root) return;
  const message = error?.reason?.message || error?.error?.message || error?.message || 'Work Timer could not start.';
  root.innerHTML = `
    <main class="startup-error">
      <section>
        <div class="eyebrow"><span class="power-dot"></span> Startup Error</div>
        <h1>Work Timer</h1>
        <p>The app hit a startup problem instead of loading a blank screen.</p>
        <button type="button" class="startup-reload">Reload app</button>
        <pre></pre>
      </section>
    </main>
  `;
  root.querySelector('.startup-reload').addEventListener('click', () => window.location.reload());
  root.querySelector('pre').textContent = message;
}

window.addEventListener('error', showStartupError);
window.addEventListener('unhandledrejection', showStartupError);

try {
  createRoot(document.getElementById('root')).render(
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  );
} catch (error) {
  showStartupError(error);
}
