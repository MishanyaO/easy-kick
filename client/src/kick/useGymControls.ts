import { useEffect, useState } from 'react';
import { gym } from '../useGambit';

export type GymStatus = 'idle' | 'running' | 'paused';

/** `gym` is the reactive persona simulator; `scenario` is the seeded ranked session with
 *  readable chat, which is the one to put on a screen. Both drive the same measurement. */
export type GymMode = 'gym' | 'scenario';

export const GYM_SPEEDS = [1, 5, 50];

/** "Gym" is what we call it in the code, and it is the wrong word on a screen: it names the
 *  machinery rather than the choice. What the streamer is picking is which simulated room to
 *  run against — one to train on, one to watch. */
export const MODE_LABEL: Record<GymMode, string> = { gym: 'Training', scenario: 'Story' };

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
  const [mode, setMode] = useState<GymMode>('scenario');

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
            setMode(g.mode);
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
    mode,
    changeSpeed: (next: number) => {
      setSpeed(next);
      // Idle: nothing to hot-change, `next` just gets picked up on the next Start.
      if (status !== 'idle') void gym.setSpeed(next);
    },
    // Which world to run is fixed for the length of a run: Start on a paused run resumes
    // it, so switching mid-run would silently lie about what is on screen.
    changeMode: (next: GymMode) => {
      if (status === 'idle') setMode(next);
    },
    start: () => void gym.start(speed, 7, mode).then(() => setStatus('running')),
    pause: () => void gym.pause().then(() => setStatus('paused')),
    stop: () => void gym.stop().then(() => {
      onStop?.();
      setStatus('idle');
    }),
  };
}

export type GymControlsState = ReturnType<typeof useGymControls>;
