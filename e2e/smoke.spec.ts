import { expect, test } from '@playwright/test';
import { openPlayer } from './helpers.js';

// Mirrors @duo/shared's join-code alphabet (docs/DESIGN.md §6) — no `@duo/shared`
// dependency at the repo root, so duplicated rather than imported.
const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A deterministic, alphabet-valid 6-char room code, unique per worker/project. */
function smokeRoomCode(projectName: string, workerIndex: number): string {
  const letter = projectName.charAt(0).toUpperCase();
  const projectLetter = ROOM_CODE_ALPHABET.includes(letter) ? letter : 'X';
  const digits = [0, 7, 13]
    .map((offset) => ROOM_CODE_ALPHABET[(workerIndex + offset) % ROOM_CODE_ALPHABET.length])
    .join('');
  return `SM${projectLetter}${digits}`;
}

test('four contexts joining one room each see all four usernames', async ({ browser }, testInfo) => {
  // Namespaced per worker/project so parallel runs don't share a Durable
  // Object room (the DO broadcasts to every socket on the instance).
  const code = smokeRoomCode(testInfo.project.name, testInfo.workerIndex);
  const usernames = ['alice', 'bob', 'carol', 'dave'];

  const sessions = await Promise.all(
    usernames.map(async (username) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await openPlayer(page, username, code);
      return { context, page };
    }),
  );

  try {
    for (const { page } of sessions) {
      await expect(page.getByTestId('roster-item')).toHaveCount(usernames.length);
      for (const username of usernames) {
        await expect(page.getByTestId('roster')).toContainText(username);
      }
    }
  } finally {
    await Promise.all(sessions.map(({ context }) => context.close()));
  }
});
