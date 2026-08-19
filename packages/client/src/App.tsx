import { useEffect, useRef, useState } from 'react';
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
import { ReconnectBanner } from './components/ReconnectBanner.js';
import { buildRoomUrl, connectSocket, loadSession, reconnectDelayMs, saveSession, sendMessage } from './net/socket.js';
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
  // Mutable, not state: the `onMessage` closure below needs to know — at the
  // moment any later `error` arrives — whether a `state` has already landed,
  // to tell "failed to join at all" apart from "an in-session action was
  // rejected" (e.g. a `TEAM_FULL` `set_team`, which must NOT boot the client
  // back to Home). Once true it stays true across a reconnect (§9) — only a
  // fresh `connect()` from Home resets it.
  const hasJoinedRef = useRef(false);
  // §9's reconnect loop: what to retry with, and how long to back off next.
  // Refs, not state — the retry timer and the socket's own closures read
  // these without needing a re-render.
  const codeRef = useRef('');
  const usernameRef = useRef('');
  const resumeTokenRef = useRef<string | undefined>(undefined);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last `state.seq` seen, purely to notice a gap (§7's safety
  // net) and proactively request a fresh resync — every `state` is already a
  // full snapshot, so this is defense in depth, not something the UI reads.
  const lastSeqRef = useRef<number | null>(null);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  /**
   * Opens one WebSocket attempt against `code`/`username` (optionally with a
   * `resumeToken` to reclaim an existing seat) and wires up its handlers.
   * Called both by `connect()` (a fresh attempt from Home) and by the
   * reconnect timer below (a retry using whatever the last known session
   * was) — `connect()` is what resets `hasJoinedRef`/backoff state; this
   * function itself never does, so a retry's own `onClose` correctly keeps
   * retrying instead of looking like a fresh failed join.
   */
  const openSocket = (code: string, username: string, resumeToken?: string) => {
    const ws = connectSocket(buildRoomUrl(WS_BASE, code), {
      onOpen: () => {
        sendMessage(ws, { t: 'join', code, username, ...(resumeToken ? { resumeToken } : {}) });
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
          // §7: "If a client sees a gap, it requests a full state resync."
          // Every `state` here is already a full snapshot, so this is a
          // defensive re-request, not strictly required to recover — but it's
          // the safety net the wire protocol names, so make it real.
          if (lastSeqRef.current !== null && parsed.value.seq > lastSeqRef.current + 1) {
            sendMessage(ws, { t: 'join', code, username, ...(resumeTokenRef.current ? { resumeToken: resumeTokenRef.current } : {}) });
          }
          lastSeqRef.current = parsed.value.seq;

          hasJoinedRef.current = true;
          reconnectAttemptRef.current = 0;
          clearReconnectTimer();
          setStatus('open');
          setView(parsed.value);

          if (parsed.value.resumeToken) {
            resumeTokenRef.current = parsed.value.resumeToken;
            saveSession({ code, username, resumeToken: parsed.value.resumeToken });
          }
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
      onClose: () => {
        if (!hasJoinedRef.current) {
          setStatus('closed');
          return;
        }
        // §9: "exponential backoff (250ms → 500ms → 1s → 2s → 5s cap), with
        // a visible 'Reconnecting…' banner" — a drop after a successful join
        // retries against the same room/seat rather than bouncing to Home.
        setStatus('reconnecting');
        const delay = reconnectDelayMs(reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          openSocket(codeRef.current, usernameRef.current, resumeTokenRef.current);
        }, delay);
      },
    });
    wsRef.current = ws;
  };

  const connect = (code: string, username: string, resumeToken?: string) => {
    codeRef.current = code;
    usernameRef.current = username;
    resumeTokenRef.current = resumeToken;
    reconnectAttemptRef.current = 0;
    lastSeqRef.current = null;
    hasJoinedRef.current = false;
    clearReconnectTimer();
    setStatus('connecting');
    setJoinError(null);
    openSocket(code, username, resumeToken);
  };

  // §9: "resume tokens ... handles refreshes." A page load with a saved
  // session skips Home entirely and rejoins straight into the room; a
  // stale/unknown token just falls back to a fresh join server-side
  // (`RoomDO.handleJoin`), so there's no failure mode here worth surfacing.
  // Guarded by a ref (not state) so React 18 StrictMode's dev-only double
  // effect invocation can't open two sockets for the same mount.
  const autoResumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoResumeAttemptedRef.current) return;
    autoResumeAttemptedRef.current = true;
    if (readFenParam()) return; // T-11's board sandbox — no room involved.
    const session = loadSession();
    if (session) connect(session.code, session.username, session.resumeToken);
  }, []);

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

  // §9: through a reconnect attempt, keep showing the last known screen
  // (board, lobby, whatever) under a banner rather than bouncing to Home —
  // `view` is never cleared on a drop, only ever replaced by a fresher one.
  const reconnecting = status === 'reconnecting';

  if (view.phase === 'IN_GAME') {
    return (
      <>
        {reconnecting && <ReconnectBanner />}
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
      </>
    );
  }

  if (view.phase === 'TEAM_SELECT') {
    return (
      <>
        {reconnecting && <ReconnectBanner />}
        <TeamSelect
          view={view}
          lastError={lastError}
          onSetTeam={handleSetTeam}
          onSetReady={handleSetReady}
          onStart={handleStart}
          onRandomize={handleRandomizeTeams}
          onPromoteSpectator={handlePromoteSpectator}
        />
      </>
    );
  }

  return (
    <>
      {reconnecting && <ReconnectBanner />}
      <Lobby view={view} onStart={handleStart} onUpdateSettings={handleUpdateSettings} onPromoteSpectator={handlePromoteSpectator} />
    </>
  );
}
