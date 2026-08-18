import { create } from 'zustand';
import type { ClientRoomView } from '@duo/shared';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

interface RoomState {
  status: ConnectionStatus;
  view: ClientRoomView | null;
  joinError: string | null;
  setStatus: (status: ConnectionStatus) => void;
  setView: (view: ClientRoomView) => void;
  setJoinError: (message: string | null) => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  status: 'idle',
  view: null,
  joinError: null,
  setStatus: (status) => set({ status }),
  setView: (view) => set({ view, joinError: null }),
  setJoinError: (joinError) => set({ joinError }),
}));
