import { useEffect, useReducer, useState } from 'react';
import type { WireProposal } from '@duo/shared';

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
  /** `serverNow - Date.now()` (see `store.ts`) — used only for the "Xs ago" age display. */
  serverClockOffsetMs?: number;
  onAccept?: (proposalId: string) => void;
  onReject?: (proposalId: string) => void;
  onWithdraw?: (proposalId: string) => void;
}

const BUTTON_BASE = 'flex h-12 min-w-[48px] items-center justify-center rounded px-4 text-sm font-semibold text-slate-100';

/**
 * `docs/DESIGN.md` §5.5 "Proposal visuals" / §4.3 rule 5: shows the live proposal in SAN, who
 * proposed it, and its age; Accept/Reject/Counter-propose for the accepter, Withdraw for the
 * proposer. Accept is disabled for 250ms after the slot changes (keyed on `proposal.id`, not
 * server time, since the anti-misclick window is about *this client noticing a change*, not
 * anything the server clock needs to agree on).
 */
export function TeamPanel({
  proposal = null,
  isProposer = false,
  proposerUsername,
  teammateUsername,
  requiresConfirmation,
  serverClockOffsetMs = 0,
  onAccept,
  onReject,
  onWithdraw,
}: TeamPanelProps) {
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
      <div data-testid="team-panel" className="flex items-center justify-between gap-3 px-3 py-2">
        <p className="text-sm text-slate-400">No proposal yet</p>
        <div className="flex gap-2">
          <button type="button" data-testid="accept-button" disabled className={`${BUTTON_BASE} bg-emerald-700 disabled:opacity-40`}>
            Accept
          </button>
          <button type="button" data-testid="reject-button" disabled className={`${BUTTON_BASE} bg-red-700 disabled:opacity-40`}>
            Reject
          </button>
        </div>
      </div>
    );
  }

  const ageSeconds = Math.max(0, Math.round((Date.now() + serverClockOffsetMs - proposal.proposedAt) / 1000));

  if (isProposer) {
    return (
      <div data-testid="team-panel" className="flex flex-col gap-2 px-3 py-2">
        <p className="text-sm text-slate-200">
          <span data-testid="proposal-san" className="font-semibold">
            {proposal.san}
          </span>{' '}
          — waiting for {teammateUsername ?? 'your teammate'}…
        </p>
        <button
          type="button"
          data-testid="withdraw-button"
          onClick={() => onWithdraw?.(proposal.id)}
          className={`${BUTTON_BASE} bg-slate-700`}
        >
          Withdraw
        </button>
      </div>
    );
  }

  return (
    <div data-testid="team-panel" className="flex flex-col gap-2 px-3 py-2">
      <p className="text-sm text-slate-200">
        <span className="font-medium">{proposerUsername ?? 'Your teammate'}</span> proposes{' '}
        <span data-testid="proposal-san" className="font-semibold">
          {proposal.san}
        </span>
        <span data-testid="proposal-age" className="ml-1 text-xs text-slate-500">
          {ageSeconds}s ago
        </span>
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="accept-button"
          disabled={!acceptReady}
          onClick={() => onAccept?.(proposal.id)}
          className={`${BUTTON_BASE} bg-emerald-700 disabled:opacity-40`}
        >
          Accept
        </button>
        <button
          type="button"
          data-testid="reject-button"
          onClick={() => onReject?.(proposal.id)}
          className={`${BUTTON_BASE} bg-red-700`}
        >
          Reject
        </button>
        <button
          type="button"
          data-testid="counter-propose-button"
          title="Drag or tap a different move on the board to counter-propose"
          className={`${BUTTON_BASE} bg-slate-700`}
        >
          Counter-propose
        </button>
      </div>
    </div>
  );
}
