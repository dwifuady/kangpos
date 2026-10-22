import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './utils/monaco';
import { initNativeMaterial } from './utils/nativeWindow';
import { installBrowserMock } from './dev/browserMock';

// Plain-browser dev preview: no Rust backend, so use the in-memory mock.
if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) installBrowserMock();

void initNativeMaterial();

// Keep the browser context menu for text fields only.
window.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement;
  const isText =
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable ||
    target.closest('.monaco-editor');
  if (!isText) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
