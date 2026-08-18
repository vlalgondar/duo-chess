import { useEffect, useRef } from 'react';
import { buildRoomUrl, connectSocket } from './net/socket.js';
import { useEchoStore } from './store.js';

const WS_BASE = import.meta.env.VITE_WS_URL;
const ECHO_CODE = 'SHELL01';

export function App() {
  const status = useEchoStore((s) => s.status);
  const messages = useEchoStore((s) => s.messages);
  const setStatus = useEchoStore((s) => s.setStatus);
  const addMessage = useEchoStore((s) => s.addMessage);
  const hasSent = useRef(false);

  useEffect(() => {
    const url = buildRoomUrl(WS_BASE, ECHO_CODE);
    const ws = connectSocket(url, {
      onOpen: () => {
        setStatus('open');
        if (!hasSent.current) {
          hasSent.current = true;
          ws.send('hello from client');
        }
      },
      onMessage: addMessage,
      onClose: () => setStatus('closed'),
    });
    return () => ws.close();
  }, [setStatus, addMessage]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-slate-100">
      <h1 className="text-2xl font-semibold">Duo Chess</h1>
      <p>
        Connection: <span data-testid="status">{status}</span>
      </p>
      <ul className="text-sm text-slate-300">
        {messages.map((message, i) => (
          <li key={i} data-testid="echo-message">
            {message}
          </li>
        ))}
      </ul>
    </main>
  );
}
