import { useEffect, useState } from 'react';
import { gym } from '../useGambit';

export type GymStatus = 'idle' | 'running' | 'paused';

export const GYM_SPEEDS = [1, 5, 50];

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
          // Only follow the server's speed while it has a gym to speak for — idle keeps
          // whatever this tab picked, ready for the next Start.
          if (g.status !== 'idle') setSpeed(g.speed);
        })
        .catch(() => undefined);
    sync();
    const id = setInterval(sync, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  const start = async () => {
    await gym.start(speed, 7);
    setStatus('running');
  };
  const pause = async () => {
    await gym.pause();
    setStatus('paused');
  };
  const stop = async () => {
    await gym.stop();
    onStop?.();
    setStatus('idle');
  };
  const changeSpeed = (next: number) => {
    setSpeed(next);
    // Idle: nothing to hot-change, `next` just gets picked up on the next Start.
    if (status !== 'idle') void gym.setSpeed(next);
  };

  return {
    status,
    speed,
    changeSpeed,
    start: () => void start(),
    pause: () => void pause(),
    stop: () => void stop(),
  };
}

export type GymControlsState = ReturnType<typeof useGymControls>;
