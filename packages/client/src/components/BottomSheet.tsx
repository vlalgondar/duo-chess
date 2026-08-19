import { useState } from 'react';
import { TeamPanel } from './TeamPanel.js';

type Tab = 'moves' | 'chat' | 'players';

const TABS: readonly Tab[] = ['moves', 'chat', 'players'];
const TAB_LABELS: Record<Tab, string> = { moves: 'Moves', chat: 'Chat', players: 'Players' };

/**
 * `docs/DESIGN.md` §5.10's mobile bottom sheet: team panel pinned above the tabs so
 * Accept/Reject stay reachable while peeked, expanding to ~60% height to reveal the
 * Moves/Chat/Players tabs. Content behind each tab is still owed by later tasks (move
 * list, chat, roster) — same "shell now, wire the data later" split as `TeamPanel`.
 */
export function BottomSheet() {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('moves');

  return (
    <div
      data-testid="bottom-sheet"
      data-expanded={expanded}
      className={`fixed inset-x-0 bottom-0 z-10 flex flex-col rounded-t-xl bg-slate-900 shadow-lg min-[900px]:hidden ${
        expanded ? 'h-[60vh]' : 'h-[120px]'
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

      <TeamPanel />

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
          <div data-testid={`tab-panel-${activeTab}`} className="flex-1 overflow-y-auto p-3 text-sm text-slate-400">
            {activeTab === 'moves' && 'No moves yet'}
            {activeTab === 'chat' && 'No messages yet'}
            {activeTab === 'players' && 'No players yet'}
          </div>
        </>
      )}
    </div>
  );
}
