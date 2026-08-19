import {
  annotationColorFor,
  connectedTeamSize,
  requiresConfirmation,
  type AnnotationColor,
  type ChatChannel,
  type ClientRoomView,
  type PromotionPiece,
  type Square,
  type WireAnnotation,
} from '@duo/shared';
import { Board, type ProposalOverlay } from '../components/Board.js';
import { BottomSheet } from '../components/BottomSheet.js';
import { Chat } from '../components/Chat.js';
import { Clock } from '../components/Clock.js';
import { Spectators } from '../components/Spectators.js';
import { TeamPanel } from '../components/TeamPanel.js';

interface GameScreenProps {
  view: ClientRoomView;
  onMove: (from: Square, to: Square, promotion?: PromotionPiece) => void;
  onAccept: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
  onWithdraw: (proposalId: string) => void;
  onSendChat: (text: string, channel: ChatChannel) => void;
  onAnnotate: (annotations: WireAnnotation[]) => void;
  serverClockOffsetMs: number;
}

// docs/DESIGN.md §5.9's "team's accent color" — one color per team (not per teammate; that
// distinction is T-22's annotation colors), used for both the proposal ghost piece and arrow.
const TEAM_ACCENT: Record<'WHITE' | 'BLACK', string> = { WHITE: '#38bdf8', BLACK: '#c084fc' };

// §5.9: "each teammate gets a fixed color (Team 1: amber/cyan, Team 2: violet/lime)" — keyed by
// which chess side you're on (this data model has no separate Team 1/Team 2, per T-17's own
// judgment call), and deliberately distinct from `TEAM_ACCENT` above so a scribble is never
// mistaken for the live proposal.
const ANNOTATION_COLORS: Record<'WHITE' | 'BLACK', Record<AnnotationColor, string>> = {
  WHITE: { A: '#fbbf24', B: '#22d3ee' }, // amber-400 / cyan-400
  BLACK: { A: '#8b5cf6', B: '#a3e635' }, // violet-500 / lime-400
};

// Same §5.10 formula BoardScreen's sandbox uses — see that file's comment for why the 220px
// deduction exists (bottom-sheet peeked height + flip-button headroom below 900px).
const BOARD_SIZE_CLASSNAME =
  'mx-auto w-[min(100vw,calc(100dvh_-_220px))] min-[900px]:w-full min-[900px]:max-w-[560px]';

/**
 * Networked game screen (T-14, propose/accept UI wired up in T-20). No optimistic commit: the
 * board always renders `view.game.fen` as received from the server's `state` broadcast, and a
 * move attempt only ever sends `propose` (via `Board`'s `serverFen`/`onMove`). Below 900px the
 * team panel lives in the same `BottomSheet` T-12 built for the local sandbox; at/above it, a
 * static side panel next to the board — the exact §5.10/§5.5 split, now with live data instead
 * of `BoardScreen`'s disabled placeholder.
 */
export function GameScreen({
  view,
  onMove,
  onAccept,
  onReject,
  onWithdraw,
  onSendChat,
  onAnnotate,
  serverClockOffsetMs,
}: GameScreenProps) {
  const you = view.seats.find((seat) => seat.publicId === view.you);
  const yourTeam = you?.team ?? null;
  const orientation = yourTeam === 'BLACK' ? 'black' : 'white';
  const game = view.game;

  if (!game) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-100">
        <p data-testid="game-status">Waiting for the game to start…</p>
      </main>
    );
  }

  const isYourTurn = yourTeam !== null && yourTeam === game.sideToMove;
  const locked = game.status !== 'ACTIVE' || !isYourTurn;

  const teamSize = yourTeam ? connectedTeamSize(view.seats, yourTeam) : 0;
  const needsConfirmation = yourTeam !== null && requiresConfirmation(teamSize);

  // §5.8: "Only if you're on a 2-player team" — the roster's full team size (not
  // `connectedTeamSize` above, which governs move-confirmation UX and treats a
  // disconnected teammate as solo), matching `sendChatMessage`'s own server-side check.
  const teamRosterSize = yourTeam ? view.seats.filter((s) => s.team === yourTeam).length : 0;
  const teamChatAvailable = yourTeam !== null && teamRosterSize >= 2;

  const proposal = view.proposal;
  const isProposer = proposal?.by === view.you;
  const proposerUsername = proposal ? view.seats.find((s) => s.publicId === proposal.by)?.username : undefined;
  const teammateUsername = view.seats.find((s) => s.team === yourTeam && s.publicId !== view.you)?.username;

  const boardProposal: ProposalOverlay | null =
    proposal && yourTeam
      ? { from: proposal.from, to: proposal.to, promotion: proposal.promotion, accentColor: TEAM_ACCENT[yourTeam] }
      : null;

  // T-22: undefined for a spectator/unassigned seat — no team to draw for, which is what turns
  // annotation drawing off in `Board` entirely.
  const ownAnnotationColor = yourTeam
    ? annotationColorFor(
        view.seats.filter((s) => s.team === yourTeam).map((s) => s.publicId),
        view.you,
      )
    : undefined;

  const statusText =
    game.status === 'ACTIVE'
      ? isYourTurn
        ? 'Your move'
        : "Opponent's move"
      : `Game over — ${game.status}${game.winner ? ` (${game.winner} wins)` : ''}`;

  // §4.6: `baseMs: 0` is "Unlimited — no clock" — nothing to show or interpolate.
  const showClocks = view.settings.timeControl.baseMs > 0;
  const top = orientation === 'white' ? 'BLACK' : 'WHITE';
  const bottom = orientation === 'white' ? 'WHITE' : 'BLACK';

  const teamPanelProps = {
    proposal,
    isProposer,
    proposerUsername,
    teammateUsername,
    requiresConfirmation: needsConfirmation,
    serverClockOffsetMs,
    onAccept,
    onReject,
    onWithdraw,
  };

  const chatProps = { messages: view.chat, teamChatAvailable, onSend: onSendChat };

  return (
    <main
      data-testid="game-shell"
      className="flex min-h-dvh flex-col bg-slate-950 text-slate-100 min-[900px]:flex-row min-[900px]:items-start min-[900px]:justify-center min-[900px]:gap-6 min-[900px]:p-6"
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 pb-[220px] min-[900px]:p-0">
        <p data-testid="game-status" className="text-sm text-slate-400">
          {statusText}
        </p>
        {/* §5.7: promotion is never offered here — `onPromote` omitted — since it's
            rejected outside LOBBY/TEAM_SELECT anyway (roomEngine.promoteSpectator). */}
        <Spectators spectators={view.spectators} seats={view.seats} />
        {showClocks && (
          <Clock
            clock={game.clock}
            team={top}
            sideToMove={game.sideToMove}
            serverClockOffsetMs={serverClockOffsetMs}
            active={game.status === 'ACTIVE' && game.sideToMove === top}
          />
        )}
        <Board
          serverFen={game.fen}
          orientation={orientation}
          onMove={locked ? undefined : onMove}
          locked={locked}
          proposal={boardProposal}
          annotations={view.annotations}
          ownAnnotationColor={ownAnnotationColor}
          annotationColors={yourTeam ? ANNOTATION_COLORS[yourTeam] : undefined}
          onAnnotationsChange={onAnnotate}
          sizeClassName={BOARD_SIZE_CLASSNAME}
        />
        {showClocks && (
          <Clock
            clock={game.clock}
            team={bottom}
            sideToMove={game.sideToMove}
            serverClockOffsetMs={serverClockOffsetMs}
            active={game.status === 'ACTIVE' && game.sideToMove === bottom}
          />
        )}
      </div>

      <aside
        data-testid="side-panel"
        className="hidden min-h-0 w-72 flex-col rounded-lg bg-slate-900 min-[900px]:flex min-[900px]:h-[80dvh]"
      >
        <TeamPanel {...teamPanelProps} />
        <div className="flex min-h-0 flex-1 flex-col border-t border-slate-800">
          <Chat {...chatProps} />
        </div>
      </aside>

      <BottomSheet teamPanel={teamPanelProps} chat={chatProps} />
    </main>
  );
}
