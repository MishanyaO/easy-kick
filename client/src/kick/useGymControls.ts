import { useEffect, useState } from 'react';
import { gym } from '../useGambit';

export type GymStatus = 'idle' | 'running' | 'paused';

export const GYM_SPEEDS = [1, 5, 50];

/**
 * Which prepared session Start plays. Set it here; `?seed=N` in the URL wins for one run,
 * which is the quick way to audition a few without editing anything.
 *
 * The seed is the entire show — the arc, the room, every card, every outcome, and where
 * the click-rally showcase lands — so a given seed always replays exactly. Its other end
 * is `DEFAULT_SEED` in `server/src/easy_kick/scenario.py`, used when a run is started
 * without one (a direct `POST /dev/gym?mode=scenario`, a headless replay).
 */
export const DEMO_SEED = 7;

/** `?seed=N`, when it is a number. Otherwise the seed above. */
function chosenSeed(): number {
  const asked = new URLSearchParams(window.location.search).get('seed');
  const seed = Number(asked);
  return asked !== null && Number.isFinite(seed) ? seed : DEMO_SEED;
}

/** How often we re-read the server's gym state. The gym lives on the server, so two
 *  open tabs (dashboard and the Insights popout) both drive the same run — polling is
 *  what keeps the second tab's buttons honest after the first one starts or stops it. */
const POLL_MS = 3000;

/**
 * The gym's state and its four controls, shared by every panel that renders them.
 *
 * Pause and Stop are distinct: pausing freezes the running gym in place (same metrics,
 * same "Time Live") so Start resumes it; Stop discards it, and the next Start begins a
 * fresh session. A stop also broadcasts a reset frame to every open tab, but `onStop`
 * lets the tab that pressed it clear itself without waiting for the round trip.
 */
export function useGymControls(onStop?: () => void) {
  const [status, setStatus] = useState<GymStatus>('idle');
  const [speed, setSpeed] = useState(5);

  useEffect(() => {
    let live = true;
    const sync = () =>
      void gym
        .status()
        .then((g) => {
          if (!live) return;
          setStatus(g.status);
          // Only follow the server's settings while it has a gym to speak for — idle keeps
          // whatever this tab picked, ready for the next Start.
          if (g.status !== 'idle') {
            setSpeed(g.speed);
          }
        })
        .catch(() => undefined);
    sync();
    const id = setInterval(sync, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  return {
    status,
    speed,
    changeSpeed: (next: number) => {
      setSpeed(next);
      // Idle: nothing to hot-change, `next` just gets picked up on the next Start.
      if (status !== 'idle') void gym.setSpeed(next);
    },
    start: () =>
      void gym.start(speed, chosenSeed(), 'scenario').then(() => setStatus('running')),
    pause: () => void gym.pause().then(() => setStatus('paused')),
    stop: () => void gym.stop().then(() => {
      onStop?.();
      setStatus('idle');
    }),
  };
}

export type GymControlsState = ReturnType<typeof useGymControls>;
