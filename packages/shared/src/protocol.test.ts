import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  acceptMessageSchema,
  annotateMessageSchema,
  annotationUpdateMessageSchema,
  chatMessageBroadcastSchema,
  chatMessageInputSchema,
  clockSyncMessageSchema,
  errorMessageSchema,
  gameOverMessageSchema,
  joinMessageSchema,
  moveCommittedMessageSchema,
  parseClientMessage,
  parseServerMessage,
  patchMessageSchema,
  pingMessageSchema,
  pongMessageSchema,
  promoteSpectatorMessageSchema,
  proposalUpdateMessageSchema,
  proposeMessageSchema,
  rejectMessageSchema,
  setReadyMessageSchema,
  setTeamMessageSchema,
  spectatorsUpdateMessageSchema,
  startGameMessageSchema,
  stateMessageSchema,
  updateSettingsMessageSchema,
  voteMessageSchema,
  withdrawMessageSchema,
} from './protocol.js';

const SETTINGS = {
  timeControl: { baseMs: 600_000, incrementMs: 5_000, label: '10+5' },
  randomizeColors: false,
  allowSpectators: true,
  disconnectGraceMs: 90_000,
};

const CLOCK = { whiteMs: 60_000, blackMs: 60_000, turnStartedAt: null, running: false };

const PROPOSAL = {
  id: 'p1',
  by: 'seat-1',
  from: 'e2',
  to: 'e4',
  san: 'e4',
  proposedAt: 1000,
};

const CHAT_MESSAGE = {
  id: 'c1',
  from: 'pub-1',
  fromName: 'alice',
  channel: 'ALL' as const,
  team: null,
  isSpectator: false,
  text: 'hi',
  at: 1000,
};

const SEAT = {
  publicId: 'pub-1',
  username: 'alice',
  team: 'WHITE' as const,
  isHost: true,
  connected: true,
  lastSeenAt: 1000,
  ready: false,
};

const SPECTATOR = {
  publicId: 'pub-2',
  username: 'bob',
  connected: true,
  joinedAt: 1000,
};

const GAME = {
  fen: 'startpos',
  moveHistory: ['e4'],
  sideToMove: 'BLACK' as const,
  clock: CLOCK,
  status: 'ACTIVE' as const,
  winner: null,
  drawOffer: null,
  pendingVotes: [],
};

const STATE_VIEW = {
  code: 'K7P2QX',
  phase: 'IN_GAME' as const,
  seats: [SEAT],
  spectators: [SPECTATOR],
  settings: SETTINGS,
  game: GAME,
  chat: [CHAT_MESSAGE],
  you: 'pub-1',
  proposal: PROPOSAL,
  annotations: [],
};

interface Case {
  name: string;
  schema: z.ZodType;
  valid: unknown;
  invalid: unknown;
}

const CLIENT_CASES: Case[] = [
  {
    name: 'join',
    schema: joinMessageSchema,
    valid: { t: 'join', code: 'K7P2QX', username: 'alice' },
    invalid: { t: 'join', code: 'not-a-code', username: 'alice' },
  },
  {
    name: 'join (username too short)',
    schema: joinMessageSchema,
    valid: { t: 'join', code: 'K7P2QX', username: 'ab', resumeToken: 'tok' },
    invalid: { t: 'join', code: 'K7P2QX', username: 'a' },
  },
  {
    name: 'set_team',
    schema: setTeamMessageSchema,
    valid: { t: 'set_team', team: 'WHITE' },
    invalid: { t: 'set_team', team: 'RED' },
  },
  {
    name: 'set_team (null allowed)',
    schema: setTeamMessageSchema,
    valid: { t: 'set_team', team: null },
    invalid: { t: 'set_team' },
  },
  {
    name: 'set_ready',
    schema: setReadyMessageSchema,
    valid: { t: 'set_ready', ready: true },
    invalid: { t: 'set_ready', ready: 'yes' },
  },
  {
    name: 'update_settings',
    schema: updateSettingsMessageSchema,
    valid: { t: 'update_settings', settings: SETTINGS },
    invalid: { t: 'update_settings', settings: { ...SETTINGS, randomizeColors: 'no' } },
  },
  {
    name: 'start_game',
    schema: startGameMessageSchema,
    valid: { t: 'start_game' },
    invalid: { t: 'start_gam' },
  },
  {
    name: 'propose',
    schema: proposeMessageSchema,
    valid: { t: 'propose', from: 'e2', to: 'e4' },
    invalid: { t: 'propose', from: 'e9', to: 'e4' },
  },
  {
    name: 'propose (with promotion)',
    schema: proposeMessageSchema,
    valid: { t: 'propose', from: 'e7', to: 'e8', promotion: 'q' },
    invalid: { t: 'propose', from: 'e7', to: 'e8', promotion: 'k' },
  },
  {
    name: 'withdraw',
    schema: withdrawMessageSchema,
    valid: { t: 'withdraw', proposalId: 'p1' },
    invalid: { t: 'withdraw', proposalId: '' },
  },
  {
    name: 'accept',
    schema: acceptMessageSchema,
    valid: { t: 'accept', proposalId: 'p1' },
    invalid: { t: 'accept' },
  },
  {
    name: 'reject',
    schema: rejectMessageSchema,
    valid: { t: 'reject', proposalId: 'p1' },
    invalid: { t: 'reject', proposalId: 42 },
  },
  {
    name: 'vote',
    schema: voteMessageSchema,
    valid: { t: 'vote', kind: 'RESIGN' },
    invalid: { t: 'vote', kind: 'SURRENDER' },
  },
  {
    name: 'chat',
    schema: chatMessageInputSchema,
    valid: { t: 'chat', text: 'hello', channel: 'TEAM' },
    invalid: { t: 'chat', text: '', channel: 'TEAM' },
  },
  {
    name: 'chat (too long)',
    schema: chatMessageInputSchema,
    valid: { t: 'chat', text: 'a'.repeat(300), channel: 'ALL' },
    invalid: { t: 'chat', text: 'a'.repeat(301), channel: 'ALL' },
  },
  {
    name: 'annotate',
    schema: annotateMessageSchema,
    valid: {
      t: 'annotate',
      annotations: [
        { kind: 'CIRCLE', from: 'e4', color: 'A' },
        { kind: 'ARROW', from: 'e2', to: 'e4', color: 'B' },
      ],
    },
    invalid: { t: 'annotate', annotations: [{ kind: 'ARROW', from: 'e2', color: 'B' }] },
  },
  {
    name: 'promote_spectator',
    schema: promoteSpectatorMessageSchema,
    valid: { t: 'promote_spectator', publicId: 'pub-1', team: 'BLACK' },
    invalid: { t: 'promote_spectator', publicId: 'pub-1', team: 'PURPLE' },
  },
  {
    name: 'ping',
    schema: pingMessageSchema,
    valid: { t: 'ping', ts: 1234 },
    invalid: { t: 'ping', ts: '1234' },
  },
];

const SERVER_CASES: Case[] = [
  {
    name: 'state',
    schema: stateMessageSchema,
    valid: { t: 'state', seq: 1, ...STATE_VIEW },
    invalid: { t: 'state', seq: -1, ...STATE_VIEW },
  },
  {
    name: 'state (spectator: null proposal, empty annotations)',
    schema: stateMessageSchema,
    valid: { t: 'state', seq: 1, ...STATE_VIEW, proposal: null, annotations: [] },
    invalid: { t: 'state', seq: 1, ...STATE_VIEW, game: { ...GAME, status: 'DRAWN' } },
  },
  {
    name: 'patch',
    schema: patchMessageSchema,
    valid: { t: 'patch', seq: 2, changes: { fen: 'x' } },
    invalid: { t: 'patch', seq: 2 },
  },
  {
    name: 'proposal_update',
    schema: proposalUpdateMessageSchema,
    valid: { t: 'proposal_update', proposal: PROPOSAL },
    invalid: { t: 'proposal_update', proposal: { ...PROPOSAL, from: 'zz' } },
  },
  {
    name: 'proposal_update (null)',
    schema: proposalUpdateMessageSchema,
    valid: { t: 'proposal_update', proposal: null },
    invalid: { t: 'proposal_update' },
  },
  {
    name: 'annotation_update',
    schema: annotationUpdateMessageSchema,
    valid: { t: 'annotation_update', by: 'pub-1', annotations: [] },
    invalid: { t: 'annotation_update', annotations: [] },
  },
  {
    name: 'chat_message',
    schema: chatMessageBroadcastSchema,
    valid: { t: 'chat_message', message: CHAT_MESSAGE },
    invalid: { t: 'chat_message', message: { ...CHAT_MESSAGE, channel: 'DM' } },
  },
  {
    name: 'spectators_update',
    schema: spectatorsUpdateMessageSchema,
    valid: { t: 'spectators_update', count: 1, list: [SPECTATOR] },
    invalid: { t: 'spectators_update', count: -1, list: [SPECTATOR] },
  },
  {
    name: 'move_committed',
    schema: moveCommittedMessageSchema,
    valid: { t: 'move_committed', san: 'e4', fen: 'x', clock: CLOCK, by: 'pub-1' },
    invalid: { t: 'move_committed', san: 'e4', fen: 'x', by: 'pub-1' },
  },
  {
    name: 'clock_sync',
    schema: clockSyncMessageSchema,
    valid: { t: 'clock_sync', whiteMs: 1, blackMs: 1, turnStartedAt: null, serverNow: 1 },
    invalid: { t: 'clock_sync', whiteMs: 1, blackMs: 1, serverNow: 1 },
  },
  {
    name: 'game_over',
    schema: gameOverMessageSchema,
    valid: { t: 'game_over', status: 'CHECKMATE', winner: 'WHITE', reason: 'checkmate' },
    invalid: { t: 'game_over', status: 'FINISHED', winner: 'WHITE', reason: 'checkmate' },
  },
  {
    name: 'error',
    schema: errorMessageSchema,
    valid: { t: 'error', code: 'ILLEGAL_MOVE', message: 'nope' },
    invalid: { t: 'error', code: 'OOPS', message: 'nope' },
  },
  {
    name: 'pong',
    schema: pongMessageSchema,
    valid: { t: 'pong', ts: 1, serverNow: 2 },
    invalid: { t: 'pong', ts: 1 },
  },
];

describe.each(CLIENT_CASES)('client message: $name', ({ schema, valid, invalid }) => {
  it('accepts a valid message', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it('rejects a malformed message', () => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });
});

describe.each(SERVER_CASES)('server message: $name', ({ schema, valid, invalid }) => {
  it('accepts a valid message', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it('rejects a malformed message', () => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });
});

describe('parseClientMessage', () => {
  it('parses every client message shape through the discriminated union', () => {
    for (const { valid } of CLIENT_CASES) {
      expect(parseClientMessage(valid)).toEqual({ ok: true, value: valid });
    }
  });

  it('rejects an unknown t', () => {
    const result = parseClientMessage({ t: 'nonsense' });
    expect(result.ok).toBe(false);
  });

  it('rejects a completely malformed payload', () => {
    expect(parseClientMessage(null).ok).toBe(false);
    expect(parseClientMessage('just a string').ok).toBe(false);
    expect(parseClientMessage(42).ok).toBe(false);
  });

  it('accepts an optional nonce and preserves it', () => {
    const result = parseClientMessage({ t: 'ping', ts: 1, nonce: 'abc' });
    expect(result).toEqual({ ok: true, value: { t: 'ping', ts: 1, nonce: 'abc' } });
  });
});

describe('parseServerMessage', () => {
  it('parses every server message shape through the discriminated union', () => {
    for (const { valid } of SERVER_CASES) {
      const result = parseServerMessage(valid);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects an unknown t', () => {
    expect(parseServerMessage({ t: 'nonsense' }).ok).toBe(false);
  });
});
