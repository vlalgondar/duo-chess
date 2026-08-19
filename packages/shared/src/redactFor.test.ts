import { describe, expect, it } from 'vitest';
import { redactFor } from './redactFor.js';
import type { GameState, Room, RoomSettings, Seat, Spectator } from './types.js';

const NOW = 1_000;

const SETTINGS: RoomSettings = {
  timeControl: { baseMs: 600_000, incrementMs: 5_000, label: '10+5' },
  randomizeColors: false,
  allowSpectators: true,
  disconnectGraceMs: 90_000,
};

function seat(overrides: Partial<Seat> & Pick<Seat, 'seatId' | 'publicId' | 'username' | 'team'>): Seat {
  return { isHost: false, connected: true, lastSeenAt: NOW, ready: true, ...overrides };
}

const white1 = seat({ seatId: 'seat-w1', publicId: 'pub-w1', username: 'white1', team: 'WHITE', isHost: true });
const white2 = seat({ seatId: 'seat-w2', publicId: 'pub-w2', username: 'white2', team: 'WHITE' });
const black1 = seat({ seatId: 'seat-b1', publicId: 'pub-b1', username: 'black1', team: 'BLACK' });
const black2 = seat({ seatId: 'seat-b2', publicId: 'pub-b2', username: 'black2', team: 'BLACK' });

const spectator: Spectator = {
  seatId: 'seat-spec',
  publicId: 'pub-spec',
  username: 'watcher',
  connected: true,
  joinedAt: NOW,
};

const ALL_SEAT_IDS = [white1, white2, black1, black2, spectator].map((s) => s.seatId);

const game: GameState = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moveHistory: [],
  sideToMove: 'WHITE',
  proposals: {
    WHITE: { id: 'prop-w', by: white1.seatId, from: 'e2', to: 'e4', san: 'e4', proposedAt: NOW },
    BLACK: { id: 'prop-b', by: black1.seatId, from: 'e7', to: 'e5', san: 'e5', proposedAt: NOW },
  },
  annotations: {
    WHITE: [{ by: white2.seatId, kind: 'CIRCLE', from: 'd4', color: 'A' }],
    BLACK: [{ by: black2.seatId, kind: 'ARROW', from: 'd7', to: 'd5', color: 'B' }],
  },
  clock: { whiteMs: 60_000, blackMs: 60_000, turnStartedAt: null, running: false },
  status: 'ACTIVE',
  winner: null,
  drawOffer: null,
  pendingVotes: [
    { kind: 'RESIGN', initiator: 'WHITE', agreedSeats: new Set([white1.seatId]), expiresAt: NOW + 30_000 },
  ],
};

const room: Room = {
  code: 'K7P2QX',
  createdAt: NOW,
  phase: 'IN_GAME',
  seats: [white1, white2, black1, black2],
  spectators: [spectator],
  chat: [
    { id: 'c1', from: white1.publicId, fromName: 'white1', channel: 'TEAM', team: 'WHITE', isSpectator: false, text: 'go e4', at: NOW },
    { id: 'c2', from: black1.publicId, fromName: 'black1', channel: 'TEAM', team: 'BLACK', isSpectator: false, text: 'go e5', at: NOW },
    { id: 'c3', from: spectator.publicId, fromName: 'watcher', channel: 'ALL', team: null, isSpectator: true, text: 'hi all', at: NOW },
  ],
  settings: SETTINGS,
  game,
};

const VIEWER_TYPES = ['WHITE', 'BLACK', 'spectator'] as const;

function viewerFor(kind: (typeof VIEWER_TYPES)[number]): Seat | Spectator {
  if (kind === 'WHITE') return white1;
  if (kind === 'BLACK') return black1;
  return spectator;
}

describe('redactFor', () => {
  it.each(VIEWER_TYPES)('%s: no seatId — own or foreign — appears anywhere in the view', (kind) => {
    const serialized = JSON.stringify(redactFor(room, viewerFor(kind)));
    for (const seatId of ALL_SEAT_IDS) {
      expect(serialized).not.toContain(seatId);
    }
  });

  it('WHITE sees the WHITE proposal (proposer identified by publicId) and not BLACK\'s', () => {
    const view = redactFor(room, white1);
    expect(view.proposal).toEqual({ id: 'prop-w', by: white1.publicId, from: 'e2', to: 'e4', san: 'e4', proposedAt: NOW });
  });

  it('BLACK sees the BLACK proposal and not WHITE\'s', () => {
    const view = redactFor(room, black1);
    expect(view.proposal).toEqual({ id: 'prop-b', by: black1.publicId, from: 'e7', to: 'e5', san: 'e5', proposedAt: NOW });
  });

  it('spectator sees no proposal', () => {
    expect(redactFor(room, spectator).proposal).toBeNull();
  });

  it('WHITE sees only the WHITE annotation, with the author stripped', () => {
    expect(redactFor(room, white1).annotations).toEqual([{ kind: 'CIRCLE', from: 'd4', color: 'A' }]);
  });

  it('BLACK sees only the BLACK annotation', () => {
    expect(redactFor(room, black1).annotations).toEqual([{ kind: 'ARROW', from: 'd7', to: 'd5', color: 'B' }]);
  });

  it('spectator sees no annotations', () => {
    expect(redactFor(room, spectator).annotations).toEqual([]);
  });

  it.each(VIEWER_TYPES)('%s sees pendingVotes.agreedSeats identified by publicId, not seatId', (kind) => {
    const view = redactFor(room, viewerFor(kind));
    expect(view.game?.pendingVotes).toEqual([
      { kind: 'RESIGN', initiator: 'WHITE', agreedSeats: [white1.publicId], expiresAt: NOW + 30_000 },
    ]);
  });

  it('WHITE sees its own TEAM chat plus ALL, not BLACK\'s TEAM chat', () => {
    const ids = redactFor(room, white1).chat.map((m) => m.id);
    expect(ids).toEqual(['c1', 'c3']);
  });

  it('BLACK sees its own TEAM chat plus ALL, not WHITE\'s TEAM chat', () => {
    const ids = redactFor(room, black1).chat.map((m) => m.id);
    expect(ids).toEqual(['c2', 'c3']);
  });

  it('spectator sees only ALL chat', () => {
    const ids = redactFor(room, spectator).chat.map((m) => m.id);
    expect(ids).toEqual(['c3']);
  });

  it('sets `you` to the viewer\'s publicId', () => {
    expect(redactFor(room, white2).you).toBe(white2.publicId);
    expect(redactFor(room, spectator).you).toBe(spectator.publicId);
  });

  it('strips seatId from every seat and spectator', () => {
    const view = redactFor(room, spectator);
    for (const s of view.seats) expect(s).not.toHaveProperty('seatId');
    for (const s of view.spectators) expect(s).not.toHaveProperty('seatId');
  });

  it.each(VIEWER_TYPES)(
    // §5.7: a spectator sees "the board, both clocks, the move list ... and the game result" —
    // the one thing every viewer type, including a spectator, gets in full and unredacted.
    '%s sees the full public game state (fen, clock, status) — only proposals/annotations/team chat are secret',
    (kind) => {
      const view = redactFor(room, viewerFor(kind));
      expect(view.game).toMatchObject({
        fen: game.fen,
        clock: game.clock,
        status: game.status,
        winner: game.winner,
      });
    },
  );

  it('spectator sees the roster of both teams and the spectator list, same as a player', () => {
    const spectatorView = redactFor(room, spectator);
    const playerView = redactFor(room, white1);
    expect(spectatorView.seats.map((s) => s.publicId)).toEqual(playerView.seats.map((s) => s.publicId));
    expect(spectatorView.spectators.map((s) => s.publicId)).toEqual([spectator.publicId]);
  });
});
