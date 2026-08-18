import { expect, test } from '@playwright/test';
import { openPlayer } from './helpers.js';

test('four contexts joining one room each see all four usernames', async ({ browser }, testInfo) => {
  // Namespaced per worker/project so parallel runs don't share a Durable
  // Object room (the DO broadcasts to every socket on the instance).
  const code = `SMOKE${testInfo.project.name.slice(0, 1).toUpperCase()}${testInfo.workerIndex}`;
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
