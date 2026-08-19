/**
 * Placeholder for `docs/DESIGN.md` §5.5's team panel — pinned above the bottom-sheet tabs
 * (§5.10) so Accept/Reject stay reachable without expanding the sheet. The propose/accept
 * state machine doesn't exist until T-18/T-20, so Accept/Reject render disabled here; this
 * task only owns their layout and the 44px minimum tap target (§5.10), same "wire the shell,
 * leave the behavior for a later task" precedent T-10 used for `start_game`/`update_settings`.
 */
export function TeamPanel() {
  return (
    <div data-testid="team-panel" className="flex items-center justify-between gap-3 px-3 py-2">
      <p className="text-sm text-slate-400">No proposal yet</p>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="accept-button"
          disabled
          className="flex h-12 min-w-[48px] items-center justify-center rounded bg-emerald-700 px-4 text-sm font-semibold text-slate-100 disabled:opacity-40"
        >
          Accept
        </button>
        <button
          type="button"
          data-testid="reject-button"
          disabled
          className="flex h-12 min-w-[48px] items-center justify-center rounded bg-red-700 px-4 text-sm font-semibold text-slate-100 disabled:opacity-40"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
