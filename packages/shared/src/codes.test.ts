import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  generateUniqueRoomCode,
  isValidRoomCode,
} from './codes.js';

describe('ROOM_CODE_ALPHABET', () => {
  it('excludes visually ambiguous characters 0, O, 1, I', () => {
    expect(ROOM_CODE_ALPHABET).not.toContain('0');
    expect(ROOM_CODE_ALPHABET).not.toContain('O');
    expect(ROOM_CODE_ALPHABET).not.toContain('1');
    expect(ROOM_CODE_ALPHABET).not.toContain('I');
  });

  it('is 32 characters, matching the documented ~1.07 billion combinations', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(ROOM_CODE_ALPHABET.length ** ROOM_CODE_LENGTH).toBe(1_073_741_824);
  });

  it('has no duplicate characters', () => {
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });
});

describe('generateRoomCode', () => {
  it('produces a 6-character code drawn only from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const char of code) {
        expect(ROOM_CODE_ALPHABET).toContain(char);
      }
    }
  });
});

describe('isValidRoomCode', () => {
  it('accepts a well-formed code', () => {
    expect(isValidRoomCode('K7P2QX')).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isValidRoomCode('K7P2Q')).toBe(false);
    expect(isValidRoomCode('K7P2QXX')).toBe(false);
  });

  it('rejects lowercase', () => {
    expect(isValidRoomCode('k7p2qx')).toBe(false);
  });

  it('rejects excluded lookalike characters', () => {
    expect(isValidRoomCode('K7P2Q0')).toBe(false); // 0
    expect(isValidRoomCode('K7P2QO')).toBe(false); // O
    expect(isValidRoomCode('K7P2Q1')).toBe(false); // 1
    expect(isValidRoomCode('K7P2QI')).toBe(false); // I
  });

  it('rejects non-alphanumeric input', () => {
    expect(isValidRoomCode('K7P2Q!')).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
  });
});

describe('generateUniqueRoomCode', () => {
  it('never returns a code already in the existing set', () => {
    const existing = new Set(['K7P2QX', 'M4B9ZR']);
    for (let i = 0; i < 500; i++) {
      expect(existing.has(generateUniqueRoomCode(existing))).toBe(false);
    }
  });

  it('generates 10k codes with retry-on-collision and every one is unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const code = generateUniqueRoomCode(seen);
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
    expect(seen.size).toBe(10_000);
  });
});
