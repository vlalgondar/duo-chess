import { create } from 'zustand';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

interface RoomState {
  status: ConnectionStatus;
  usernames: string[];
  setStatus: (status: ConnectionStatus) => void;
  addUsername: (username: string) => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  status: 'idle',
  usernames: [],
  setStatus: (status) => set({ status }),
  addUsername: (username) =>
    set((state) =>
      state.usernames.includes(username) ? state : { usernames: [...state.usernames, username] },
    ),
}));
