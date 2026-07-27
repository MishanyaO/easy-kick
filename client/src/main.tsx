import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// DESIGN REFERENCE (ticket 004) — `?design` mounts the approved F and R7 prototypes on
// invented data. Not part of the product; delete with src/design/.
import Reference from './design/Reference';
// `?kick` mounts the same live surfaces inside a replica of dashboard.kick.com/stream.
// A query param, not a path: the backend already serves the SSE stream at /stream.
import KickDashboard from './kick/KickDashboard';
// `?insights` is the drawer's popout: Review at full viewport, in its own tab.
import InsightsPage from './kick/InsightsPage';
import './index.css';

const params = new URLSearchParams(window.location.search);
const Root = params.has('design')
  ? Reference
  : params.has('insights')
    ? InsightsPage
    : params.has('kick')
      ? KickDashboard
      : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
