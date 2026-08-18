import { create } from 'zustand';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

interface RoomState {
  status: ConnectionStatus;
  usernames: string[];
  setStatus: (status: ConnectionStatus) => void;
  setUsernames: (usernames: string[]) => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  status: 'idle',
  usernames: [],
  setStatus: (status) => set({ status }),
  setUsernames: (usernames) => set({ usernames }),
}));
