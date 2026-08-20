import { expect, test } from '@playwright/test';
import { openPlayer } from './helpers.js';

test('four contexts joining one room each see all four usernames', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();

  const usernames = ['alice', 'bob', 'carol', 'dave'];
  const [hostUsername, ...guestUsernames] = usernames;

  try {
    // T-30: a room only exists once someone explicitly creates it — a
    // generated code (unique per run) replaces the old deterministic,
    // worker-namespaced one, so alice must create before the others can join.
    await hostPage.goto('/');
    await hostPage.getByTestId('username-input').fill(hostUsername!);
    await hostPage.getByTestId('create-room-button').click();
    const code = (await hostPage.getByTestId('room-code').textContent())?.trim();
    if (!code) throw new Error('room code was not rendered in the lobby');

    const guestSessions = await Promise.all(
      guestUsernames.map(async (username) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await openPlayer(page, username, code);
        return { context, page };
      }),
    );

    try {
      for (const page of [hostPage, ...guestSessions.map((s) => s.page)]) {
        await expect(page.getByTestId('roster-item')).toHaveCount(usernames.length);
        for (const username of usernames) {
          await expect(page.getByTestId('roster')).toContainText(username);
        }
      }
    } finally {
      await Promise.all(guestSessions.map(({ context }) => context.close()));
    }
  } finally {
    await hostContext.close();
  }
});
