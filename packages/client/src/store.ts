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
  setStatus: (status: ConnectionStatus) => void;
  setView: (view: ClientRoomView) => void;
  setJoinError: (message: string | null) => void;
  setServerClockOffsetMs: (offsetMs: number) => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  status: 'idle',
  view: null,
  joinError: null,
  serverClockOffsetMs: 0,
  setStatus: (status) => set({ status }),
  setView: (view) => set({ view, joinError: null }),
  setJoinError: (joinError) => set({ joinError }),
  setServerClockOffsetMs: (serverClockOffsetMs) => set({ serverClockOffsetMs }),
}));
