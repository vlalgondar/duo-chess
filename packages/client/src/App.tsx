import { useRef, useState } from 'react';
import {
  generateRoomCode,
  parseServerMessage,
  type ChatChannel,
  type PromotionPiece,
  type RoomSettings,
  type Square,
  type Team,
  type WireAnnotation,
} from '@duo/shared';
import { buildRoomUrl, connectSocket, sendMessage } from './net/socket.js';
import { BoardScreen } from './screens/BoardScreen.js';
import { GameScreen } from './screens/GameScreen.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { TeamSelect } from './screens/TeamSelect.js';
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
  const lastError = useRoomStore((s) => s.lastError);
  const setStatus = useRoomStore((s) => s.setStatus);
  const setView = useRoomStore((s) => s.setView);
  const setJoinError = useRoomStore((s) => s.setJoinError);
  const setServerClockOffsetMs = useRoomStore((s) => s.setServerClockOffsetMs);
  const setLastError = useRoomStore((s) => s.setLastError);
  const appendChatMessage = useRoomStore((s) => s.appendChatMessage);
  const applyAnnotationUpdate = useRoomStore((s) => s.applyAnnotationUpdate);

  const wsRef = useRef<WebSocket | null>(null);
  // Mutable, not state: the `onMessage` closure below is created once per
  // `connect()` call and needs to know — at the moment any later `error`
  // arrives — whether a `state` has already landed, to tell "failed to join
  // at all" apart from "an in-session action was rejected" (e.g. a
  // `TEAM_FULL` `set_team`, which must NOT boot the client back to Home).
  const hasJoinedRef = useRef(false);

  const connect = (code: string, username: string) => {
    setStatus('connecting');
    setJoinError(null);
    hasJoinedRef.current = false;

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
          hasJoinedRef.current = true;
          setView(parsed.value);
        } else if (parsed.value.t === 'clock_sync') {
          setServerClockOffsetMs(parsed.value.serverNow - Date.now());
        } else if (parsed.value.t === 'chat_message') {
          appendChatMessage(parsed.value.message);
        } else if (parsed.value.t === 'annotation_update') {
          applyAnnotationUpdate(parsed.value.by, parsed.value.annotations);
        } else if (parsed.value.t === 'error') {
          if (hasJoinedRef.current) {
            setLastError(parsed.value.code);
          } else {
            setJoinError(parsed.value.message);
            setStatus('closed');
          }
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

  const handleSetTeam = (team: Team | null) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'set_team', team });
  };

  const handleSetReady = (ready: boolean) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'set_ready', ready });
  };

  const handleRandomizeTeams = () => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'randomize_teams' });
  };

  const handlePromoteSpectator = (publicId: string, team: Team) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'promote_spectator', publicId, team });
  };

  const handleMove = (from: Square, to: Square, promotion?: PromotionPiece) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'propose', from, to, promotion });
  };

  const handleAccept = (proposalId: string) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'accept', proposalId });
  };

  const handleReject = (proposalId: string) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'reject', proposalId });
  };

  const handleWithdraw = (proposalId: string) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'withdraw', proposalId });
  };

  const handleSendChat = (text: string, channel: ChatChannel) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'chat', text, channel });
  };

  const handleAnnotate = (annotations: WireAnnotation[]) => {
    if (wsRef.current) sendMessage(wsRef.current, { t: 'annotate', annotations });
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
    return (
      <GameScreen
        view={view}
        onMove={handleMove}
        onAccept={handleAccept}
        onReject={handleReject}
        onWithdraw={handleWithdraw}
        onSendChat={handleSendChat}
        onAnnotate={handleAnnotate}
        serverClockOffsetMs={serverClockOffsetMs}
      />
    );
  }

  if (view.phase === 'TEAM_SELECT') {
    return (
      <TeamSelect
        view={view}
        lastError={lastError}
        onSetTeam={handleSetTeam}
        onSetReady={handleSetReady}
        onStart={handleStart}
        onRandomize={handleRandomizeTeams}
        onPromoteSpectator={handlePromoteSpectator}
      />
    );
  }

  return (
    <Lobby view={view} onStart={handleStart} onUpdateSettings={handleUpdateSettings} onPromoteSpectator={handlePromoteSpectator} />
  );
}
