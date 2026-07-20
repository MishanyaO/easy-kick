// Backend base URL. Override with VITE_API_URL when the server is not on localhost.
export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

/** Whether to show the simulator control panel (`npm run dev:simulator`). */
export const SIMULATOR_UI = import.meta.env.VITE_SIMULATOR_UI === 'true';

export type ReplayStatus = {
  status: 'running' | 'idle' | 'stopped';
  speed: number;
  loop: boolean;
  total: number;
  sent: number;
  dataset: string;
};

/** Carries the HTTP status so callers can tell "simulator off" (404) from a real outage. */
export class ReplayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function replay(method: string, query = ''): Promise<ReplayStatus> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/dev/replay${query}`, { method });
  } catch {
    throw new ReplayError(`cannot reach the backend at ${API_BASE}`, 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ReplayError(body?.detail ?? `replay failed (${res.status})`, res.status);
  }
  return res.json() as Promise<ReplayStatus>;
}

export const simulator = {
  status: () => replay('GET'),
  stop: () => replay('DELETE'),
  start: (speed: number, loop: boolean) =>
    replay('POST', `?speed=${speed}&loop=${loop}`),
};
