/**
 * Join code generation, per docs/DESIGN.md §6 "Join code generation".
 *
 * 32-character alphabet (Crockford base32 minus the digits/letters that are
 * visually ambiguous at a glance: `0`/`O`, `1`/`I`) — 32^6 ≈ 1.07 billion
 * combinations. `L` is deliberately kept; it's not confusable with any other
 * character in this alphabet.
 *
 * `generateUniqueRoomCode` implements "generate, check for collision, retry"
 * against a caller-supplied set — this module has no storage access, so the
 * set of codes currently in use has to come from the caller (the DO
 * namespace, in practice).
 */
import type { RoomCode } from './types.js';

export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function isValidRoomCode(code: string): code is RoomCode {
  return ROOM_CODE_PATTERN.test(code);
}

/**
 * Draws from a uniform byte per character and reduces mod 32 — unbiased
 * because the alphabet length (32) evenly divides the byte range (256).
 */
export function generateRoomCode(): RoomCode {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);

  let code = '';
  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

/** Generates codes until one isn't in `existing`, per docs/DESIGN.md §6. */
export function generateUniqueRoomCode(existing: ReadonlySet<RoomCode>): RoomCode {
  let code = generateRoomCode();
  while (existing.has(code)) {
    code = generateRoomCode();
  }
  return code;
}
