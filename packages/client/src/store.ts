import { create } from 'zustand';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

interface EchoState {
  status: ConnectionStatus;
  messages: string[];
  setStatus: (status: ConnectionStatus) => void;
  addMessage: (message: string) => void;
}

export const useEchoStore = create<EchoState>((set) => ({
  status: 'connecting',
  messages: [],
  setStatus: (status) => set({ status }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
}));
