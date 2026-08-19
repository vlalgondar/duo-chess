import { expect, test } from '@playwright/test';
import { openPlayer } from './helpers.js';

test('leaving the Lobby frees the seat, promotes a new host, and a stale session does not auto-resume', async ({
  browser,
}) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const carolContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const carolPage = await carolContext.newPage();

  try {
    await alicePage.goto('/');
    await alicePage.getByTestId('username-input').fill('alice');
    await alicePage.getByTestId('create-room-button').click();
    const code = (await alicePage.getByTestId('room-code').textContent())?.trim();
    if (!code) throw new Error('room code was not rendered in the lobby');

    await openPlayer(bobPage, 'bob', code);
    await openPlayer(carolPage, 'carol', code);
    await expect(alicePage.getByTestId('roster-item')).toHaveCount(3);

    // bob leaves — his seat frees up for everyone else, and he lands back on Home.
    await bobPage.getByTestId('leave-button').click();
    await expect(bobPage.getByTestId('create-room-button')).toBeVisible();
    await expect(alicePage.getByTestId('roster-item')).toHaveCount(2);
    await expect(carolPage.getByTestId('roster-item')).toHaveCount(2);

    // The leave clears the saved session — a reload does not auto-resume into the room.
    await bobPage.reload();
    await expect(bobPage.getByTestId('create-room-button')).toBeVisible();

    // bob rejoins from Home: a fresh join, not a reconnect — the roster grows back, but
    // he is not the seat he left (in particular, not host).
    await openPlayer(bobPage, 'bob', code);
    await expect(alicePage.getByTestId('roster-item')).toHaveCount(3);
    await expect(bobPage.getByTestId('roster-item').filter({ hasText: 'bob' })).not.toContainText('(host)');

    // alice (the host) leaves — the earliest remaining seat (carol) is promoted, and the
    // room keeps working for her: only a host sees the Start button.
    await alicePage.getByTestId('leave-button').click();
    await expect(alicePage.getByTestId('create-room-button')).toBeVisible();
    await expect(carolPage.getByTestId('roster-item')).toHaveCount(2);
    await expect(carolPage.getByTestId('start-button')).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
    await carolContext.close();
  }
});

test('the Leave button appears pre-game but not during an active game, and again once it ends', async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await hostPage.goto('/');
    await hostPage.getByTestId('username-input').fill('alice');
    await hostPage.getByTestId('create-room-button').click();
    const code = (await hostPage.getByTestId('room-code').textContent())?.trim();
    if (!code) throw new Error('room code was not rendered in the lobby');

    await openPlayer(guestPage, 'bob', code);
    await expect(hostPage.getByTestId('start-button')).toBeEnabled();
    await hostPage.getByTestId('start-button').click(); // LOBBY -> TEAM_SELECT

    // Team Select: the button is there too.
    await expect(hostPage.getByTestId('team-select-shell')).toBeVisible();
    await expect(hostPage.getByTestId('leave-button')).toBeVisible();

    await hostPage.locator('[data-testid="team-card"][data-username="alice"] [data-testid="move-left"]').click();
    await guestPage.locator('[data-testid="team-card"][data-username="bob"] [data-testid="move-right"]').click();
    await hostPage.locator('[data-testid="team-card"][data-username="alice"] [data-testid="ready-toggle"]').click();
    await guestPage.locator('[data-testid="team-card"][data-username="bob"] [data-testid="ready-toggle"]').click();
    await expect(hostPage.getByTestId('start-game-button')).toBeEnabled();
    await hostPage.getByTestId('start-game-button').click(); // TEAM_SELECT -> IN_GAME

    // Mid-game: no way to abandon a seat outright — Resign is the only exit.
    await expect(hostPage.getByTestId('game-shell')).toBeVisible();
    await expect(hostPage.getByTestId('leave-button')).toHaveCount(0);
    await expect(hostPage.getByTestId('resign-button')).toBeVisible();

    // Solo team (1v1) — Resign is immediate, behind a confirm dialog.
    hostPage.once('dialog', (dialog) => dialog.accept());
    await hostPage.getByTestId('resign-button').click();

    // Result screen: the button is back, alongside Rematch.
    await expect(hostPage.getByTestId('result-banner')).toBeVisible();
    await expect(hostPage.getByTestId('leave-button')).toBeVisible();
    await expect(hostPage.getByTestId('rematch-button')).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
