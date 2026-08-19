import { useRef, useState } from 'react';
import { generateRoomCode, parseServerMessage, type PromotionPiece, type RoomSettings, type Square } from '@duo/shared';
import { buildRoomUrl, connectSocket, sendMessage } from './net/socket.js';
import { BoardScreen } from './screens/BoardScreen.js';
import { GameScreen } from './screens/GameScreen.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { useRoomStore } from './store.js';

const WS_BASE = import.meta.env.VITE_WS_URL;

/** T-11's local board sandbox, reached via `?fen=<FEN>` — no room/server involved (see `BoardScreen`). */
function readFenParam(): string | null {
  return new URLSearchParams(window.location.search).get('fen');
}

export function App() {
  const [boardFen] = useState(readFenParam);

  const status = useRoomStore((s) => s.status);
  const view = useRoomStore((s) => s.view);
  const joinError = useRoomStore((s) => s.joinError);
  const serverClockOffsetMs = useRoomStore((s) => s.serverClockOffsetMs);
  const setStatus = useRoomStore((s) => s.setStatus);
  const setView = useRoomStore((s) => s.setView);
  const setJoinError = useRoomStore((s) => s.setJoinError);
  const setServerClockOffsetMs = useRoomStore((s) => s.setServerClockOffsetMs);

  const wsRef = useRef<WebSocket | null>(null);

  const connect = (code: string, username: string) => {
    setStatus('connecting');
    setJoinError(null);

    const ws = connectSocket(buildRoomUrl(WS_BASE, code), {
      onOpen: () => {
        setStatus('open');
        sendMessage(ws, { t: 'join', code, username });
      },
      onMessage: (data) => {
        let raw: unknown;
        try {
          raw = JSON.parse(data);
        } catch {
          return;
        }

        const parsed = parseServerMessage(raw);
        if (!parsed.ok) return;

        if (parsed.value.t === 'state') {
          setView(parsed.value);
        } else if (parsed.value.t === 'clock_sync') {
          setServerClockOffsetMs(parsed.value.serverNow - Date.now());
        } else if (parsed.value.t === 'error') {
          setJoinError(parsed.value.message);
          setStatus('closed');
        }
      },
      onClose: () => setStatus('closed'),
    });
    wsRef.current = ws;
  };

  const handleStart = () => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'start_game' });
  };

  const handleUpdateSettings = (settings: RoomSettings) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'update_settings', settings });
  };

  const handleMove = (from: Square, to: Square, promotion?: PromotionPiece) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'propose', from, to, promotion });
  };

  if (boardFen) {
    return <BoardScreen initialFen={boardFen} />;
  }

  if (!view) {
    return (
      <Home
        onCreate={(username) => connect(generateRoomCode(), username)}
        onJoin={(username, code) => connect(code, username)}
        joinError={joinError}
        busy={status === 'connecting'}
      />
    );
  }

  if (view.phase === 'IN_GAME') {
    return <GameScreen view={view} onMove={handleMove} serverClockOffsetMs={serverClockOffsetMs} />;
  }

  return <Lobby view={view} onStart={handleStart} onUpdateSettings={handleUpdateSettings} />;
}
