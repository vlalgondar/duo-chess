import { useEffect, useState, type FormEvent } from 'react';
import type { ChatChannel, ChatMessage } from '@duo/shared';

interface ChatProps {
  messages: ChatMessage[];
  /** §5.8: "Only if you're on a 2-player team, and only during IN_GAME." Hides the Team tab otherwise. */
  teamChatAvailable: boolean;
  onSend: (text: string, channel: ChatChannel) => void;
}

const MAX_CHAT_LENGTH = 300;

const CHANNEL_LABEL: Record<ChatChannel, string> = { TEAM: 'Team', ALL: 'All' };

/**
 * `docs/DESIGN.md` §5.8: two channels in one panel toggled by a segmented control, defaulting
 * to Team during a game (when it's available at all — solo teams/spectators never see it, per
 * `teamChatAvailable`), with a small unread dot on whichever channel isn't currently showing.
 * `messages` is already server-scoped by `redactFor()` (TEAM only ever contains the viewer's own
 * team's messages, or none for a spectator) — this component only ever filters by channel for
 * *display*, never by team, since there's nothing foreign in the array to filter out.
 */
export function Chat({ messages, teamChatAvailable, onSend }: ChatProps) {
  const [channel, setChannel] = useState<ChatChannel>(teamChatAvailable ? 'TEAM' : 'ALL');
  const [text, setText] = useState('');
  const [seenCount, setSeenCount] = useState<Record<ChatChannel, number>>({ TEAM: 0, ALL: 0 });

  const activeChannel = teamChatAvailable ? channel : 'ALL';

  useEffect(() => {
    setSeenCount((current) => ({
      ...current,
      [activeChannel]: messages.filter((m) => m.channel === activeChannel).length,
    }));
  }, [activeChannel, messages]);

  const shown = messages.filter((m) => m.channel === activeChannel);
  const unread: Record<ChatChannel, number> = {
    TEAM: Math.max(0, messages.filter((m) => m.channel === 'TEAM').length - seenCount.TEAM),
    ALL: Math.max(0, messages.filter((m) => m.channel === 'ALL').length - seenCount.ALL),
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH);
    if (!trimmed) return;
    onSend(trimmed, activeChannel);
    setText('');
  };

  return (
    <div data-testid="chat-panel" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 px-3 pt-2">
        {(teamChatAvailable ? (['TEAM', 'ALL'] as const) : (['ALL'] as const)).map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`chat-channel-${c.toLowerCase()}`}
            aria-pressed={activeChannel === c}
            onClick={() => setChannel(c)}
            className={`relative rounded px-3 py-1 text-xs font-medium ${
              activeChannel === c ? 'bg-emerald-700 text-slate-100' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {CHANNEL_LABEL[c]}
            {activeChannel !== c && unread[c] > 0 && (
              <span
                data-testid={`chat-unread-${c.toLowerCase()}`}
                className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-sky-400"
              />
            )}
          </button>
        ))}
      </div>

      <div data-testid="chat-messages" className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm">
        {shown.length === 0 && <p className="text-slate-500">No messages yet</p>}
        {shown.map((m) => (
          <p key={m.id} data-testid="chat-message" className={m.isSpectator ? 'text-slate-500' : 'text-slate-200'}>
            <span className="font-medium">
              {m.isSpectator ? `\u{1F441} ${m.fromName}` : m.fromName}
            </span>
            : {m.text}
          </p>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex shrink-0 gap-2 px-3 pb-3">
        <input
          data-testid="chat-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={`Message ${CHANNEL_LABEL[activeChannel]}…`}
          className="h-11 min-w-0 flex-1 rounded bg-slate-800 px-3 text-sm text-slate-100 placeholder:text-slate-500"
        />
        <button
          type="submit"
          data-testid="chat-send"
          className="h-11 shrink-0 rounded bg-emerald-700 px-4 text-sm font-semibold text-slate-100"
        >
          Send
        </button>
      </form>
    </div>
  );
}
