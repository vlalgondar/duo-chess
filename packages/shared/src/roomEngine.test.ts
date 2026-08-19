import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOM_SETTINGS,
  MAX_SEATS,
  MAX_SPECTATORS,
  advanceToTeamSelect,
  canStartGame,
  createRoom,
  joinRoom,
  leaveRoom,
  promoteSpectator,
  randomizeTeams,
  setConnected,
  setReady,
  setTeam,
  startGameFromTeamSelect,
  updateSettings,
} from './roomEngine.js';
import type { RoomJoiner } from './roomEngine.js';
import type { Room, Seat, Team } from './types.js';

const NOW = 1_000;

function joiner(n: number): RoomJoiner {
  return { seatId: `seat-${n}`, publicId: `pub-${n}`, username: `user${n}` };
}

function roomWithHost(): Room {
  return createRoom('K7P2QX', joiner(0), NOW);
}

/** Fills the room to `count` total seats (including the host), unassigned. */
function roomWithSeats(count: number): Room {
  let room = roomWithHost();
  for (let i = 1; i < count; i++) {
    const result = joinRoom(room, joiner(i), NOW);
    if (!result.ok || result.value.role !== 'seat') {
      throw new Error('setup expected a seat');
    }
    room = result.value.room;
  }
  return room;
}

describe('createRoom', () => {
  it('starts in LOBBY with the host as the sole seat', () => {
    const room = roomWithHost();
    expect(room.phase).toBe('LOBBY');
    expect(room.seats).toHaveLength(1);
    expect(room.seats[0]).toMatchObject({
      seatId: 'seat-0',
      isHost: true,
      team: null,
      ready: false,
      connected: true,
    });
    expect(room.spectators).toEqual([]);
    expect(room.game).toBeNull();
  });

  it('defaults settings when none are given', () => {
    expect(roomWithHost().settings).toEqual(DEFAULT_ROOM_SETTINGS);
  });

  it('accepts caller-supplied settings', () => {
    const settings = { ...DEFAULT_ROOM_SETTINGS, allowSpectators: false };
    const room = createRoom('K7P2QX', joiner(0), NOW, settings);
    expect(room.settings).toEqual(settings);
  });
});

describe('joinRoom', () => {
  it('seats a joiner while the room has room', () => {
    const result = joinRoom(roomWithHost(), joiner(1), NOW);
    expect(result).toMatchObject({ ok: true, value: { role: 'seat' } });
    if (result.ok) {
      expect(result.value.room.seats).toHaveLength(2);
      expect(result.value.room.seats[1]).toMatchObject({ seatId: 'seat-1', isHost: false });
    }
  });

  it(`spectates the ${MAX_SEATS + 1}th joiner once all seats are taken`, () => {
    const full = roomWithSeats(MAX_SEATS);
    const result = joinRoom(full, joiner(MAX_SEATS), NOW);
    expect(result).toMatchObject({ ok: true, value: { role: 'spectator' } });
    if (result.ok) {
      expect(result.value.room.seats).toHaveLength(MAX_SEATS);
      expect(result.value.room.spectators).toHaveLength(1);
    }
  });

  it('spectates any joiner while the game is in progress, even with an open seat', () => {
    const room: Room = { ...roomWithSeats(2), phase: 'IN_GAME' };
    const result = joinRoom(room, joiner(2), NOW);
    expect(result).toMatchObject({ ok: true, value: { role: 'spectator' } });
  });

  it('refuses spectators with SPECTATORS_DISABLED when settings forbid it', () => {
    const settings = { ...DEFAULT_ROOM_SETTINGS, allowSpectators: false };
    const full = { ...roomWithSeats(MAX_SEATS), settings };
    const result = joinRoom(full, joiner(MAX_SEATS), NOW);
    expect(result).toEqual({ ok: false, code: 'SPECTATORS_DISABLED' });
  });

  it(`refuses the ${MAX_SPECTATORS + 1}th spectator with ROOM_FULL`, () => {
    let room = roomWithSeats(MAX_SEATS);
    for (let i = 0; i < MAX_SPECTATORS; i++) {
      const result = joinRoom(room, joiner(MAX_SEATS + i), NOW);
      if (!result.ok) throw new Error('setup expected success');
      room = result.value.room;
    }
    const result = joinRoom(room, joiner(999), NOW);
    expect(result).toEqual({ ok: false, code: 'ROOM_FULL' });
  });
});

describe('leaveRoom', () => {
  it('removes a seated player', () => {
    const room = roomWithSeats(2);
    const after = leaveRoom(room, 'seat-1');
    expect(after.seats.map((s) => s.seatId)).toEqual(['seat-0']);
  });

  it('removes a spectator', () => {
    const full = roomWithSeats(MAX_SEATS);
    const joined = joinRoom(full, joiner(MAX_SEATS), NOW);
    if (!joined.ok) throw new Error('setup expected success');
    const after = leaveRoom(joined.value.room, `seat-${MAX_SEATS}`);
    expect(after.spectators).toEqual([]);
  });

  it('promotes the earliest remaining seat to host when the host leaves', () => {
    const room = roomWithSeats(3);
    const after = leaveRoom(room, 'seat-0');
    expect(after.seats.map((s) => s.seatId)).toEqual(['seat-1', 'seat-2']);
    expect(after.seats[0]!.isHost).toBe(true);
    expect(after.seats[1]!.isHost).toBe(false);
  });

  it('is a no-op for an unknown seatId', () => {
    const room = roomWithHost();
    expect(leaveRoom(room, 'nobody')).toEqual(room);
  });
});

describe('setTeam', () => {
  it('assigns a seat to a team', () => {
    const room = roomWithSeats(2);
    const result = setTeam(room, 'seat-1', 'WHITE', NOW);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.seats.find((s) => s.seatId === 'seat-1')?.team).toBe('WHITE');
    }
  });

  it('unassigns with team: null', () => {
    const room = roomWithSeats(2);
    const assigned = setTeam(room, 'seat-1', 'WHITE', NOW);
    if (!assigned.ok) throw new Error('setup expected success');
    const result = setTeam(assigned.value, 'seat-1', null, NOW);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.seats.find((s) => s.seatId === 'seat-1')?.team).toBeNull();
    }
  });

  it('rejects a third player joining an already-full team with TEAM_FULL', () => {
    const room = roomWithSeats(3);
    const first = setTeam(room, 'seat-0', 'WHITE', NOW);
    if (!first.ok) throw new Error('setup expected success');
    const second = setTeam(first.value, 'seat-1', 'WHITE', NOW);
    if (!second.ok) throw new Error('setup expected success');

    const third = setTeam(second.value, 'seat-2', 'WHITE', NOW);
    expect(third).toEqual({ ok: false, code: 'TEAM_FULL' });
    // rejection must not mutate — the third seat stays unassigned
    expect(second.value.seats.find((s) => s.seatId === 'seat-2')?.team).toBeNull();
  });

  it('lets a seat already on a full team re-set the same team (no-op, not a rejection)', () => {
    const room = roomWithSeats(2);
    const first = setTeam(room, 'seat-0', 'WHITE', NOW);
    if (!first.ok) throw new Error('setup expected success');
    const second = setTeam(first.value, 'seat-1', 'WHITE', NOW);
    if (!second.ok) throw new Error('setup expected success');

    const result = setTeam(second.value, 'seat-0', 'WHITE', NOW);
    expect(result).toMatchObject({ ok: true });
  });

  it('returns SEAT_NOT_FOUND for an unknown seatId', () => {
    const result = setTeam(roomWithHost(), 'nobody', 'WHITE', NOW);
    expect(result).toEqual({ ok: false, code: 'SEAT_NOT_FOUND' });
  });

  it.each(['IN_GAME', 'FINISHED'] as const)(
    'rejects with INVALID_PHASE once the room is %s — a mid-game team hop must not let someone move the wrong side',
    (phase) => {
      const room: Room = { ...roomWithSeats(2), phase };
      expect(setTeam(room, 'seat-0', 'WHITE', NOW)).toEqual({ ok: false, code: 'INVALID_PHASE' });
    },
  );
});

describe('setReady', () => {
  it('toggles ready', () => {
    const room = roomWithHost();
    const result = setReady(room, 'seat-0', true, NOW);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.seats[0]!.ready).toBe(true);
    }
  });

  it('returns SEAT_NOT_FOUND for an unknown seatId', () => {
    const result = setReady(roomWithHost(), 'nobody', true, NOW);
    expect(result).toEqual({ ok: false, code: 'SEAT_NOT_FOUND' });
  });

  it.each(['IN_GAME', 'FINISHED'] as const)('rejects with INVALID_PHASE once the room is %s', (phase) => {
    const room: Room = { ...roomWithHost(), phase };
    expect(setReady(room, 'seat-0', true, NOW)).toEqual({ ok: false, code: 'INVALID_PHASE' });
  });
});

describe('updateSettings', () => {
  const newSettings = { ...DEFAULT_ROOM_SETTINGS, allowSpectators: false };

  it('applies the change for the host', () => {
    const room = roomWithHost();
    const result = updateSettings(room, 'seat-0', newSettings);
    expect(result).toEqual({ ok: true, value: { ...room, settings: newSettings } });
  });

  it('rejects a non-host with NOT_HOST', () => {
    const room = roomWithSeats(2);
    const result = updateSettings(room, 'seat-1', newSettings);
    expect(result).toEqual({ ok: false, code: 'NOT_HOST' });
  });

  it('returns SEAT_NOT_FOUND for an unknown actor', () => {
    const result = updateSettings(roomWithHost(), 'nobody', newSettings);
    expect(result).toEqual({ ok: false, code: 'SEAT_NOT_FOUND' });
  });
});

describe('promoteSpectator', () => {
  function roomWithOneSpectator(): Room {
    const full = roomWithSeats(MAX_SEATS);
    const joined = joinRoom(full, joiner(MAX_SEATS), NOW);
    if (!joined.ok) throw new Error('setup expected success');
    return joined.value.room;
  }

  it('moves the spectator into an open seat on the given team', () => {
    let room = roomWithOneSpectator();
    room = leaveRoom(room, 'seat-1'); // free a seat
    const result = promoteSpectator(room, 'seat-0', `pub-${MAX_SEATS}`, 'WHITE', NOW);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.spectators).toEqual([]);
      const promoted = result.value.seats.find((s) => s.publicId === `pub-${MAX_SEATS}`);
      expect(promoted).toMatchObject({ seatId: `seat-${MAX_SEATS}`, team: 'WHITE', isHost: false });
    }
  });

  it('rejects a non-host with NOT_HOST', () => {
    const room = roomWithOneSpectator();
    const result = promoteSpectator(room, 'seat-1', `pub-${MAX_SEATS}`, 'WHITE', NOW);
    expect(result).toEqual({ ok: false, code: 'NOT_HOST' });
  });

  it('rejects promotion during IN_GAME with INVALID_PHASE', () => {
    const room: Room = { ...roomWithOneSpectator(), phase: 'IN_GAME' };
    const result = promoteSpectator(room, 'seat-0', `pub-${MAX_SEATS}`, 'WHITE', NOW);
    expect(result).toEqual({ ok: false, code: 'INVALID_PHASE' });
  });

  it('returns SPECTATOR_NOT_FOUND for an unknown publicId', () => {
    const room = roomWithOneSpectator();
    const result = promoteSpectator(room, 'seat-0', 'nobody', 'WHITE', NOW);
    expect(result).toEqual({ ok: false, code: 'SPECTATOR_NOT_FOUND' });
  });

  it('returns ROOM_FULL when all 4 seats are already taken', () => {
    const room = roomWithOneSpectator(); // 4 seats + 1 spectator
    const result = promoteSpectator(room, 'seat-0', `pub-${MAX_SEATS}`, 'WHITE', NOW);
    expect(result).toEqual({ ok: false, code: 'ROOM_FULL' });
  });

  it('returns TEAM_FULL when the target team already has 2 players', () => {
    let room = roomWithOneSpectator();
    room = leaveRoom(room, 'seat-2'); // free a seat, keep 2 on WHITE below
    const first = setTeam(room, 'seat-0', 'WHITE', NOW);
    if (!first.ok) throw new Error('setup expected success');
    const second = setTeam(first.value, 'seat-1', 'WHITE', NOW);
    if (!second.ok) throw new Error('setup expected success');

    const result = promoteSpectator(second.value, 'seat-0', `pub-${MAX_SEATS}`, 'WHITE', NOW);
    expect(result).toEqual({ ok: false, code: 'TEAM_FULL' });
  });
});

describe('canStartGame', () => {
  function seatsWithTeams(teams: ReadonlyArray<'WHITE' | 'BLACK' | null>): Seat[] {
    return teams.map((team, i) => ({
      seatId: `seat-${i}`,
      publicId: `pub-${i}`,
      username: `user${i}`,
      team,
      isHost: i === 0,
      connected: true,
      lastSeenAt: NOW,
      ready: true,
    }));
  }

  it.each([
    ['2v2', ['WHITE', 'WHITE', 'BLACK', 'BLACK']],
    ['2v1', ['WHITE', 'WHITE', 'BLACK']],
    ['1v2', ['WHITE', 'BLACK', 'BLACK']],
    ['1v1', ['WHITE', 'BLACK']],
  ] as const)('allows %s', (_label, teams) => {
    expect(canStartGame(seatsWithTeams(teams))).toBe(true);
  });

  it('refuses to start with an empty team', () => {
    expect(canStartGame(seatsWithTeams(['WHITE', 'WHITE']))).toBe(false);
    expect(canStartGame(seatsWithTeams(['WHITE', null]))).toBe(false);
  });

  it('refuses a 3-player team', () => {
    expect(canStartGame(seatsWithTeams(['WHITE', 'WHITE', 'WHITE', 'BLACK']))).toBe(false);
  });

  it('ignores unassigned seats sitting alongside a valid split', () => {
    expect(canStartGame(seatsWithTeams(['WHITE', 'BLACK', null]))).toBe(true);
  });
});

describe('advanceToTeamSelect', () => {
  it('moves a LOBBY room to TEAM_SELECT without touching seats', () => {
    const room = roomWithSeats(2);
    const result = advanceToTeamSelect(room, 'seat-0');
    if (!result.ok) throw new Error('expected success');

    expect(result.value.phase).toBe('TEAM_SELECT');
    expect(result.value.seats).toEqual(room.seats);
  });

  it('rejects a non-host actor', () => {
    expect(advanceToTeamSelect(roomWithSeats(2), 'seat-1')).toEqual({ ok: false, code: 'NOT_HOST' });
  });

  it('rejects an unknown seat', () => {
    expect(advanceToTeamSelect(roomWithSeats(2), 'nope')).toEqual({ ok: false, code: 'SEAT_NOT_FOUND' });
  });

  it('rejects a single-player room', () => {
    expect(advanceToTeamSelect(roomWithSeats(1), 'seat-0')).toEqual({ ok: false, code: 'TEAM_SIZE_INVALID' });
  });

  it('rejects starting outside the LOBBY phase', () => {
    const teamSelect = advanceToTeamSelect(roomWithSeats(2), 'seat-0');
    if (!teamSelect.ok) throw new Error('setup expected success');
    expect(advanceToTeamSelect(teamSelect.value, 'seat-0')).toEqual({ ok: false, code: 'INVALID_PHASE' });
  });
});

describe('startGameFromTeamSelect', () => {
  /** `random()` that never flips colors (>= 0.5) — the common case for tests not about the coin flip itself. */
  const noFlip = () => 1;

  /** A TEAM_SELECT room with every seat assigned via `setTeam` and marked ready. */
  function readyTeamSelectRoom(teams: (Team | null)[]): Room {
    let room = roomWithSeats(teams.length);
    const advanced = advanceToTeamSelect(room, 'seat-0');
    if (!advanced.ok) throw new Error('setup expected success');
    room = advanced.value;

    teams.forEach((team, i) => {
      if (team === null) return;
      const result = setTeam(room, `seat-${i}`, team, NOW);
      if (!result.ok) throw new Error('setup expected success');
      room = result.value;
    });
    return {
      ...room,
      seats: room.seats.map((s) => ({ ...s, ready: true })),
    };
  }

  it('starts a 1v1 game once both seats are on a team and ready', () => {
    const room = readyTeamSelectRoom(['WHITE', 'BLACK']);
    const result = startGameFromTeamSelect(room, 'seat-0', noFlip);
    if (!result.ok) throw new Error('expected success');

    expect(result.value.phase).toBe('IN_GAME');
    expect(result.value.seats.map((s) => [s.seatId, s.team])).toEqual([
      ['seat-0', 'WHITE'],
      ['seat-1', 'BLACK'],
    ]);
    expect(result.value.game).toMatchObject({
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      sideToMove: 'WHITE',
      status: 'ACTIVE',
    });
  });

  it.each([
    ['2v2', ['WHITE', 'WHITE', 'BLACK', 'BLACK']],
    ['2v1', ['WHITE', 'WHITE', 'BLACK']],
    ['1v2', ['WHITE', 'BLACK', 'BLACK']],
  ] as const)('starts a %s game', (_label, teams) => {
    const result = startGameFromTeamSelect(readyTeamSelectRoom([...teams]), 'seat-0', noFlip);
    expect(result.ok).toBe(true);
  });

  it('rejects a non-host actor', () => {
    expect(startGameFromTeamSelect(readyTeamSelectRoom(['WHITE', 'BLACK']), 'seat-1', noFlip)).toEqual({
      ok: false,
      code: 'NOT_HOST',
    });
  });

  it('rejects outside the TEAM_SELECT phase', () => {
    expect(startGameFromTeamSelect(roomWithSeats(2), 'seat-0', noFlip)).toEqual({ ok: false, code: 'INVALID_PHASE' });
  });

  it('rejects an invalid team composition (everyone crowded onto one side, the other empty)', () => {
    // Only 2v0 is reachable through legitimate `setTeam` calls — `setTeam`
    // itself already refuses a third player onto a full team (TEAM_FULL),
    // so 3v0/4v0 can never actually happen this way.
    const room = readyTeamSelectRoom(['WHITE', 'WHITE']);
    expect(startGameFromTeamSelect(room, 'seat-0', noFlip)).toEqual({ ok: false, code: 'TEAM_SIZE_INVALID' });
  });

  it('rejects a straggler still sitting Unassigned, even if the two counted teams are valid', () => {
    const room = readyTeamSelectRoom(['WHITE', 'BLACK', null]);
    expect(startGameFromTeamSelect(room, 'seat-0', noFlip)).toEqual({ ok: false, code: 'TEAM_SIZE_INVALID' });
  });

  it('rejects when not every seat is ready', () => {
    const ready = readyTeamSelectRoom(['WHITE', 'BLACK']);
    const notReady = { ...ready, seats: ready.seats.map((s, i) => (i === 1 ? { ...s, ready: false } : s)) };
    expect(startGameFromTeamSelect(notReady, 'seat-0', noFlip)).toEqual({ ok: false, code: 'NOT_ALL_READY' });
  });

  describe('randomizeColors (§4.2)', () => {
    function readyRoomWithRandomizeColors(): Room {
      const room = readyTeamSelectRoom(['WHITE', 'BLACK']);
      return { ...room, settings: { ...room.settings, randomizeColors: true } };
    }

    it('leaves colors alone when the coin flip lands >= 0.5', () => {
      const result = startGameFromTeamSelect(readyRoomWithRandomizeColors(), 'seat-0', () => 0.5);
      if (!result.ok) throw new Error('expected success');
      expect(result.value.seats.map((s) => [s.seatId, s.team])).toEqual([
        ['seat-0', 'WHITE'],
        ['seat-1', 'BLACK'],
      ]);
    });

    it('swaps every seat\'s WHITE/BLACK label when the coin flip lands < 0.5', () => {
      const result = startGameFromTeamSelect(readyRoomWithRandomizeColors(), 'seat-0', () => 0.1);
      if (!result.ok) throw new Error('expected success');
      expect(result.value.seats.map((s) => [s.seatId, s.team])).toEqual([
        ['seat-0', 'BLACK'],
        ['seat-1', 'WHITE'],
      ]);
    });

    it('never flips when settings.randomizeColors is off, regardless of the coin flip', () => {
      const result = startGameFromTeamSelect(readyTeamSelectRoom(['WHITE', 'BLACK']), 'seat-0', () => 0.1);
      if (!result.ok) throw new Error('expected success');
      expect(result.value.seats.map((s) => [s.seatId, s.team])).toEqual([
        ['seat-0', 'WHITE'],
        ['seat-1', 'BLACK'],
      ]);
    });
  });
});

describe('randomizeTeams', () => {
  function fixedRandom(...values: number[]): () => number {
    let i = 0;
    return () => values[i++ % values.length]!;
  }

  it.each([2, 3, 4])('produces a valid, fully-assigned composition for %i seats', (count) => {
    const room = roomWithSeats(count);
    const teamSelect = advanceToTeamSelect(room, 'seat-0');
    if (!teamSelect.ok) throw new Error('setup expected success');

    const result = randomizeTeams(teamSelect.value, 'seat-0', fixedRandom(0.1, 0.9, 0.5));
    if (!result.ok) throw new Error('expected success');

    expect(result.value.seats.every((s) => s.team !== null)).toBe(true);
    expect(canStartGame(result.value.seats)).toBe(true);
  });

  it('rejects a non-host actor', () => {
    const room = roomWithSeats(2);
    const teamSelect = advanceToTeamSelect(room, 'seat-0');
    if (!teamSelect.ok) throw new Error('setup expected success');
    expect(randomizeTeams(teamSelect.value, 'seat-1', fixedRandom(0))).toEqual({ ok: false, code: 'NOT_HOST' });
  });

  it('rejects outside the TEAM_SELECT phase', () => {
    expect(randomizeTeams(roomWithSeats(2), 'seat-0', fixedRandom(0))).toEqual({ ok: false, code: 'INVALID_PHASE' });
  });
});

describe('setConnected', () => {
  it('marks a seat disconnected and bumps lastSeenAt', () => {
    const room = roomWithHost();
    const result = setConnected(room, 'seat-0', false, NOW + 1);
    expect(result.seats[0]).toMatchObject({ connected: false, lastSeenAt: NOW + 1 });
  });

  it('marks a seat reconnected', () => {
    const room = setConnected(roomWithHost(), 'seat-0', false, NOW + 1);
    const result = setConnected(room, 'seat-0', true, NOW + 2);
    expect(result.seats[0]).toMatchObject({ connected: true, lastSeenAt: NOW + 2 });
  });

  it('marks a spectator disconnected without touching lastSeenAt (spectators have none)', () => {
    const full = roomWithSeats(MAX_SEATS);
    const withSpectator = joinRoom(full, joiner(MAX_SEATS), NOW);
    if (!withSpectator.ok || withSpectator.value.role !== 'spectator') {
      throw new Error('setup expected a spectator');
    }
    const result = setConnected(withSpectator.value.room, `seat-${MAX_SEATS}`, false, NOW + 1);
    expect(result.spectators[0]).toMatchObject({ connected: false });
  });

  it('is a no-op for an unknown seatId', () => {
    const room = roomWithHost();
    expect(setConnected(room, 'nope', false, NOW + 1)).toEqual(room);
  });
});
