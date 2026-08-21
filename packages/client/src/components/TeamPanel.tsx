import { useEffect, useReducer, useState } from 'react';
import type { WireProposal } from '@duo/shared';
import { Button } from '../ui/Button.js';
import { useRoomStore } from '../store.js';

interface TeamPanelProps {
  /** The viewer's own team's live proposal (`view.proposal`, already team-scoped by `redactFor`). */
  proposal?: WireProposal | null;
  /** `true` when the viewer is the proposal's own proposer (sees Withdraw, not Accept/Reject). */
  isProposer?: boolean;
  proposerUsername?: string | undefined;
  teammateUsername?: string | undefined;
  /**
   * §4.4: hides the panel entirely for a solo team — undefined (the sandbox's zero-props
   * usage, see `BoardScreen`) is treated as "show the shell" so T-12's mobile-shell e2e specs
   * keep exercising the same disabled Accept/Reject placeholder they always have.
   */
  requiresConfirmation?: boolean;
  onAccept?: (proposalId: string) => void;
  onReject?: (proposalId: string) => void;
  onWithdraw?: (proposalId: string) => void;
}

/**
 * `docs/DESIGN.md` §5.5 "Proposal visuals" / §4.3 rule 5: shows the live proposal in SAN, who
 * proposed it, and its age; Accept/Reject/Counter-propose for the accepter, Withdraw for the
 * proposer. Accept is disabled for 250ms after the slot changes (keyed on `proposal.id`, not
 * server time, since the anti-misclick window is about *this client noticing a change*, not
 * anything the server clock needs to agree on). The card also re-keys on `proposal.id` so its
 * `proposal-pulse` CSS animation replays on every slot change (§5.5: "a brief highlight pulse
 * so the change is visible rather than mysterious") — same re-key trick `TeamSelect`'s shake
 * animation already relies on.
 */
export function TeamPanel({
  proposal = null,
  isProposer = false,
  proposerUsername,
  teammateUsername,
  requiresConfirmation,
  onAccept,
  onReject,
  onWithdraw,
}: TeamPanelProps) {
  // Read directly rather than taking it as a prop (as it used to) — a `clock_sync` arrives
  // every 5s and used to re-render `App`'s whole tree just to keep this offset current here.
  const serverClockOffsetMs = useRoomStore((s) => s.serverClockOffsetMs);
  const [acceptReady, setAcceptReady] = useState(false);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    setAcceptReady(false);
    if (!proposal) return undefined;
    const readyTimer = setTimeout(() => setAcceptReady(true), 250);
    const ageTimer = setInterval(tick, 1000);
    return () => {
      clearTimeout(readyTimer);
      clearInterval(ageTimer);
    };
  }, [proposal?.id]);

  if (requiresConfirmation === false) return null; // §4.4/§5.5: hidden entirely for solo teams

  if (!proposal) {
    return (
      <div data-testid="team-panel" className="flex items-center justify-between gap-3 px-3 py-2.5">
        <p className="text-sm text-text-dim">No proposal yet</p>
        <div className="flex gap-2">
          <Button type="button" data-testid="accept-button" variant="primary" size="lg" disabled>
            Accept
          </Button>
          <Button type="button" data-testid="reject-button" variant="danger" size="lg" disabled>
            Reject
          </Button>
        </div>
      </div>
    );
  }

  const ageSeconds = Math.max(0, Math.round((Date.now() + serverClockOffsetMs - proposal.proposedAt) / 1000));

  if (isProposer) {
    return (
      <div key={proposal.id} data-testid="team-panel" className="proposal-pulse flex flex-col gap-2 px-3 py-2.5">
        <p className="text-sm text-text">
          <span data-testid="proposal-san" className="font-mono text-lg font-semibold text-accent">
            {proposal.san}
          </span>{' '}
          <span className="text-text-muted">— waiting for {teammateUsername ?? 'your teammate'}…</span>
        </p>
        <Button type="button" data-testid="withdraw-button" variant="secondary" onClick={() => onWithdraw?.(proposal.id)}>
          Withdraw
        </Button>
      </div>
    );
  }

  return (
    <div key={proposal.id} data-testid="team-panel" className="proposal-pulse flex flex-col gap-2 px-3 py-2.5">
      <p className="text-sm text-text">
        <span className="font-medium">{proposerUsername ?? 'Your teammate'}</span>{' '}
        <span className="text-text-muted">proposes</span>{' '}
        <span data-testid="proposal-san" className="font-mono text-lg font-semibold text-accent">
          {proposal.san}
        </span>
        <span data-testid="proposal-age" className="ml-1 text-xs text-text-dim">
          {ageSeconds}s ago
        </span>
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          data-testid="accept-button"
          variant="primary"
          size="lg"
          disabled={!acceptReady}
          onClick={() => onAccept?.(proposal.id)}
        >
          Accept
        </Button>
        <Button type="button" data-testid="reject-button" variant="danger" size="lg" onClick={() => onReject?.(proposal.id)}>
          Reject
        </Button>
        <Button
          type="button"
          data-testid="counter-propose-button"
          variant="ghost"
          title="Drag or tap a different move on the board to counter-propose"
        >
          Counter-propose
        </Button>
      </div>
    </div>
  );
}
