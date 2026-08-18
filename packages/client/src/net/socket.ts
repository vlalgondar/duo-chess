/** Joins a base `VITE_WS_URL` (e.g. `wss://host/ws`) with a room code, per docs/DESIGN.md §12. */
export function buildRoomUrl(base: string, code: string): string {
  return `${base.replace(/\/+$/, '')}/${code}`;
}

export interface SocketHandlers {
  onOpen?: () => void;
  onMessage?: (data: string) => void;
  onClose?: () => void;
}

export function connectSocket(url: string, handlers: SocketHandlers): WebSocket {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => handlers.onOpen?.());
  ws.addEventListener('message', (event) => {
    handlers.onMessage?.(typeof event.data === 'string' ? event.data : '');
  });
  ws.addEventListener('close', () => handlers.onClose?.());
  return ws;
}
