import { expect, test, type Page } from '@playwright/test';

/** Locates a specific player's card anywhere on the Team Select screen. */
function cardFor(page: Page, username: string) {
  return page.locator(`[data-testid="team-card"][data-username="${username}"]`);
}

test('four contexts pick teams, a full-team attempt is refused, and the host starts the game', async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const carolContext = await browser.newContext();
  const daveContext = await browser.newContext();

  const hostPage = await hostContext.newPage();
  const bobPage = await bobContext.newPage();
  const carolPage = await carolContext.newPage();
  const davePage = await daveContext.newPage();
  const allPages = [hostPage, bobPage, carolPage, davePage];

  try {
    await hostPage.goto('/');
    await hostPage.getByTestId('username-input').fill('alice');
    await hostPage.getByTestId('create-room-button').click();
    const code = (await hostPage.getByTestId('room-code').textContent())?.trim();
    if (!code) throw new Error('room code was not rendered in the lobby');

    for (const [page, username] of [
      [bobPage, 'bob'],
      [carolPage, 'carol'],
      [davePage, 'dave'],
    ] as const) {
      await page.goto(`/join/${code}`);
      await page.getByTestId('username-input').fill(username);
      await page.getByTestId('join-button').click();
    }

    await expect(hostPage.getByTestId('roster-item')).toHaveCount(4);
    await expect(hostPage.getByTestId('start-button')).toBeEnabled();
    await hostPage.getByTestId('start-button').click(); // LOBBY -> TEAM_SELECT

    for (const page of allPages) {
      await expect(page.getByTestId('team-select-shell')).toBeVisible();
    }

    // alice and bob join Team 1 (White) — one arrow-button press each from Unassigned.
    await cardFor(hostPage, 'alice').getByTestId('move-left').click();
    await cardFor(bobPage, 'bob').getByTestId('move-left').click();

    // Propagation: everyone, not just the mover, sees both cards land on White.
    for (const page of allPages) {
      await expect(
        page.locator('[data-testid="team-panel-white"] [data-testid="team-card"][data-username="alice"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="team-panel-white"] [data-testid="team-card"][data-username="bob"]'),
      ).toBeVisible();
    }

    // carol joins Team 2 (Black).
    await cardFor(carolPage, 'carol').getByTestId('move-right').click();
    await expect(
      davePage.locator('[data-testid="team-panel-black"] [data-testid="team-card"][data-username="carol"]'),
    ).toBeVisible();

    // dave tries to join White too — already full (alice, bob) — server refuses it.
    await cardFor(davePage, 'dave').getByTestId('move-left').click();
    await expect(
      davePage.locator('[data-testid="unassigned-strip"] [data-testid="team-card"][data-username="dave"]'),
    ).toBeVisible();
    await expect(
      hostPage.locator('[data-testid="team-panel-white"] [data-testid="team-card"][data-username="dave"]'),
    ).toHaveCount(0);
    // The card returns / never left — White still shows exactly its original two.
    await expect(hostPage.locator('[data-testid="team-panel-white"] [data-testid="team-card"]')).toHaveCount(2);

    // dave joins Black instead, where there's still room.
    await cardFor(davePage, 'dave').getByTestId('move-right').click();
    await expect(
      hostPage.locator('[data-testid="team-panel-black"] [data-testid="team-card"][data-username="dave"]'),
    ).toBeVisible();

    for (const [page, username] of [
      [hostPage, 'alice'],
      [bobPage, 'bob'],
      [carolPage, 'carol'],
      [davePage, 'dave'],
    ] as const) {
      await cardFor(page, username).getByTestId('ready-toggle').click();
    }

    await expect(hostPage.getByTestId('start-game-button')).toBeEnabled();
    await hostPage.getByTestId('start-game-button').click(); // TEAM_SELECT -> IN_GAME

    for (const page of allPages) {
      await expect(page.getByTestId('game-shell')).toBeVisible();
    }
  } finally {
    await hostContext.close();
    await bobContext.close();
    await carolContext.close();
    await daveContext.close();
  }
});

test('the host can send everyone back to the Lobby, clearing team picks and ready state', async ({ browser }) => {
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

    await guestPage.goto(`/join/${code}`);
    await guestPage.getByTestId('username-input').fill('bob');
    await guestPage.getByTestId('join-button').click();

    await hostPage.getByTestId('start-button').click(); // LOBBY -> TEAM_SELECT
    await expect(hostPage.getByTestId('team-select-shell')).toBeVisible();
    await expect(guestPage.getByTestId('team-select-shell')).toBeVisible();

    // Non-host never sees the control.
    await expect(guestPage.getByTestId('back-to-lobby-button')).toHaveCount(0);

    await cardFor(hostPage, 'alice').getByTestId('move-left').click();
    await cardFor(guestPage, 'bob').getByTestId('move-right').click();
    await cardFor(hostPage, 'alice').getByTestId('ready-toggle').click();
    await cardFor(guestPage, 'bob').getByTestId('ready-toggle').click();
    await expect(hostPage.getByTestId('start-game-button')).toBeEnabled();

    await hostPage.getByTestId('back-to-lobby-button').click(); // TEAM_SELECT -> LOBBY
    await expect(hostPage.getByTestId('roster')).toBeVisible();
    await expect(guestPage.getByTestId('roster')).toBeVisible();

    // Re-entering Team Select starts from a clean slate — nobody is still on a team
    // or ready from before the trip back to the Lobby.
    await hostPage.getByTestId('start-button').click(); // LOBBY -> TEAM_SELECT, again
    await expect(cardFor(hostPage, 'alice')).toBeVisible();
    await expect(hostPage.locator('[data-testid="unassigned-strip"] [data-testid="team-card"]')).toHaveCount(2);
    await expect(hostPage.getByTestId('start-game-button')).toBeDisabled();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
