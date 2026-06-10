
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Liquid-glass design system tokens + material. Scoped under `.bp-glass-scope`
// so it only styles the new design-language tiles (legacy tiles are untouched).
import './design-system/tokens.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
