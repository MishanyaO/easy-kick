import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// DESIGN REFERENCE (ticket 004) — `?design` mounts the approved F and R7 prototypes on
// invented data. Not part of the product; delete with src/design/.
import Reference from './design/Reference';
import './index.css';

const Root = new URLSearchParams(window.location.search).has('design') ? Reference : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
