import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// DESIGN REFERENCE (ticket 004) — `?design` mounts the approved F and R7 prototypes on
// invented data. Not part of the product; delete with src/design/.
import Reference from './design/Reference';
// The dashboard: a replica of dashboard.kick.com/stream over the live SSE surfaces.
import KickDashboard from './kick/KickDashboard';
// `?insights` is the drawer's popout: Review at full viewport, in its own tab.
import InsightsPage from './kick/InsightsPage';
import './index.css';

const params = new URLSearchParams(window.location.search);
const Root = params.has('design')
  ? Reference
  : params.has('insights')
    ? InsightsPage
    : KickDashboard;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
