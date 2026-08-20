import type { GameStatus, Team, TeamVoteKind, WireTeamVote } from '@duo/shared';
import { Button } from '../ui/Button.js';
import { Flag } from '../ui/Icon.js';

interface VoteActionsProps {
  yourTeam: Team | null;
  you: string;
  gameStatus: GameStatus;
  pendingVotes: WireTeamVote[];
  drawOffer: { by: Team; at: number } | null;
  /** §4.5: a solo team's vote resolves the instant it's sent — no teammate to wait on. */
  requiresConfirmation: boolean;
  onVote: (kind: TeamVoteKind) => void;
}

const VOTE_LABEL: Record<TeamVoteKind, string> = {
  RESIGN: 'resign',
  DRAW_OFFER: 'offer a draw',
  DRAW_ACCEPT: 'accept the draw',
  TAKEBACK: 'request a takeback',
};

/**
 * §4.5/§7 "Team-level decisions": resign, offer a draw, and accept the opponents' offer, all the
 * same generic `TeamVote` mechanic on the wire (`{ t: 'vote', kind }`). A solo team's vote (or a
 * 2-player team missing its other member — the same "temporarily solo" treatment the rest of the
 * app gives a disconnected teammate) resolves the instant it's sent, so it gets a native confirm
 * dialog for Resign (§4.5's own table: "Immediate (with a confirm dialog)") since there's no
 * teammate-agreement step to double as one; a connected 2-player team's first click starts a
 * pending vote instead, and *that* — waiting on a real second person — is the confirmation.
 */
export function VoteActions({ yourTeam, you, gameStatus, pendingVotes, drawOffer, requiresConfirmation, onVote }: VoteActionsProps) {
  if (yourTeam === null || gameStatus !== 'ACTIVE') return null;

  const ownVote = pendingVotes.find((v) => v.initiator === yourTeam);
  const incomingOffer = drawOffer !== null && drawOffer.by !== yourTeam;

  if (ownVote) {
    const label = VOTE_LABEL[ownVote.kind];
    if (ownVote.agreedSeats.includes(you)) {
      return (
        <p data-testid="vote-status" className="text-sm text-text-muted">
          Waiting for your teammate to agree to {label}…
        </p>
      );
    }
    return (
      <div data-testid="vote-status" className="flex items-center gap-2 text-sm text-text">
        <span>Your teammate wants to {label}.</span>
        <Button type="button" data-testid="agree-vote-button" variant="primary" onClick={() => onVote(ownVote.kind)}>
          Agree
        </Button>
      </div>
    );
  }

  const handleResign = () => {
    if (requiresConfirmation || window.confirm('Resign the game?')) onVote('RESIGN');
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {incomingOffer && (
        <div data-testid="draw-offer-banner" className="flex items-center gap-2 text-sm text-text">
          <span>The other team offers a draw.</span>
          <Button type="button" data-testid="accept-draw-button" variant="primary" onClick={() => onVote('DRAW_ACCEPT')}>
            Accept Draw
          </Button>
        </div>
      )}
      <Button type="button" data-testid="resign-button" variant="danger" onClick={handleResign}>
        <Flag className="h-4 w-4" aria-hidden="true" />
        Resign
      </Button>
      <Button type="button" data-testid="offer-draw-button" variant="secondary" onClick={() => onVote('DRAW_OFFER')}>
        Offer Draw
      </Button>
    </div>
  );
}
