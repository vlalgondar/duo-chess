import { create } from 'zustand';
import type { ClientRoomView } from '@duo/shared';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

interface RoomState {
  status: ConnectionStatus;
  view: ClientRoomView | null;
  joinError: string | null;
  /**
   * `serverNow - Date.now()` as of the last `clock_sync` (§8.6). `Clock`
   * adds this to its own `Date.now()` inside a `requestAnimationFrame` loop
   * to interpolate a smooth countdown that stays correct against server
   * time rather than the viewer's own clock, which the design explicitly
   * calls out as always losing on disagreement.
   */
  serverClockOffsetMs: number;
  /**
   * An `error` received *after* joining (e.g. `TEAM_FULL` from a rejected
   * `set_team`) — distinct from `joinError`, which is specifically about
   * failing to join at all. Screens react to this locally (e.g. the Team
   * Select shake animation) without navigating anywhere; nothing ever
   * un-applies a change here since the server never applied it either — the
   * next `state` broadcast (or lack of one) is already the source of truth.
   * `at` makes repeats of the same `code` distinguishable so an effect keyed
   * on it still re-fires.
   */
  lastError: { code: string; at: number } | null;
  setStatus: (status: ConnectionStatus) => void;
  setView: (view: ClientRoomView) => void;
  setJoinError: (message: string | null) => void;
  setServerClockOffsetMs: (offsetMs: number) => void;
  setLastError: (code: string) => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  status: 'idle',
  view: null,
  joinError: null,
  serverClockOffsetMs: 0,
  lastError: null,
  setStatus: (status) => set({ status }),
  setView: (view) => set({ view, joinError: null }),
  setJoinError: (joinError) => set({ joinError }),
  setServerClockOffsetMs: (serverClockOffsetMs) => set({ serverClockOffsetMs }),
  setLastError: (code) => set({ lastError: { code, at: Date.now() } }),
}));
