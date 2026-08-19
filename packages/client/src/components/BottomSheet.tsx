import { useState, type ComponentProps } from 'react';
import { Chat } from './Chat.js';
import { TeamPanel } from './TeamPanel.js';

type Tab = 'moves' | 'chat' | 'players';

const TABS: readonly Tab[] = ['moves', 'chat', 'players'];
const TAB_LABELS: Record<Tab, string> = { moves: 'Moves', chat: 'Chat', players: 'Players' };

interface BottomSheetProps {
  /** Forwarded verbatim to `TeamPanel` — omitted by the local sandbox (`BoardScreen`), wired by `GameScreen` (T-20). */
  teamPanel?: ComponentProps<typeof TeamPanel>;
  /** Forwarded verbatim to `Chat` — omitted by the local sandbox, wired by `GameScreen` (T-21). */
  chat?: ComponentProps<typeof Chat>;
}

/**
 * `docs/DESIGN.md` §5.10's mobile bottom sheet: team panel pinned above the tabs so
 * Accept/Reject stay reachable while peeked, expanding to ~60% height to reveal the
 * Moves/Chat/Players tabs. Content behind each tab is still owed by later tasks (move
 * list, chat, roster) — same "shell now, wire the data later" split as `TeamPanel`.
 */
export function BottomSheet({ teamPanel, chat }: BottomSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('moves');

  return (
    <div
      data-testid="bottom-sheet"
      data-expanded={expanded}
      className={`fixed inset-x-0 bottom-0 z-10 flex flex-col rounded-t-xl bg-slate-900 shadow-lg min-[900px]:hidden ${
        // Peeked is `min-h`, not a fixed `h`, so a live proposal's taller content (SAN +
        // three buttons vs. the one-line placeholder) grows the sheet instead of pushing
        // Accept/Reject below the fixed-position box and out of the viewport (§5.10:
        // "pinned above the tabs so Accept/Reject is always reachable without expanding").
        expanded ? 'h-[60vh]' : 'min-h-[120px]'
      }`}
    >
      <button
        type="button"
        data-testid="sheet-handle"
        onClick={() => setExpanded((current) => !current)}
        className="flex h-11 w-full shrink-0 items-center justify-center"
      >
        <span className="h-1.5 w-12 rounded-full bg-slate-600" />
      </button>

      <TeamPanel {...teamPanel} />

      {expanded && (
        <>
          <div className="flex shrink-0 border-t border-slate-800">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                data-testid={`tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                aria-selected={activeTab === tab}
                className={`h-11 flex-1 text-sm font-medium ${
                  activeTab === tab ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
          <div
            data-testid={`tab-panel-${activeTab}`}
            className={`flex min-h-0 flex-1 flex-col ${activeTab === 'chat' ? '' : 'overflow-y-auto p-3 text-sm text-slate-400'}`}
          >
            {activeTab === 'moves' && 'No moves yet'}
            {activeTab === 'chat' && (chat ? <Chat {...chat} /> : <p className="p-3 text-sm text-slate-400">No messages yet</p>)}
            {activeTab === 'players' && 'No players yet'}
          </div>
        </>
      )}
    </div>
  );
}
