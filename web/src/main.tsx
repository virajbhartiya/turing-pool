import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './product.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Turing Swap root element is missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
