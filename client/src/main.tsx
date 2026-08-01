import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// DESIGN REFERENCE (ticket 004) — `?design` mounts the approved F and R7 prototypes on
// invented data. Not part of the product; delete with src/design/.
import Reference from './design/Reference';
// The dashboard: a replica of dashboard.kick.com/stream over the live SSE surfaces.
import KickDashboard from './kick/KickDashboard';
// `?insights` is the Insights panel's popout — the same panel, in its own window, the way
// Kick's popout icon means it everywhere else.
import InsightsPanelPage from './kick/InsightsPanelPage';
// `?review` is the different, fuller view behind its own button: the Actions ledger, the
// policy map and the participation leaderboard at full viewport.
import ReviewPage from './kick/ReviewPage';
import './index.css';

const params = new URLSearchParams(window.location.search);
const Root = params.has('design')
  ? Reference
  : params.has('review')
    ? ReviewPage
    : params.has('insights')
      ? InsightsPanelPage
      : KickDashboard;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
