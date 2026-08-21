import { expect, test } from '@playwright/test';
import { tapSquare } from './helpers.js';

/**
 * Post-ship captured-pieces feature (`material.ts`/`CapturedTray.tsx`, `docs/DESIGN.md`
 * §5.5/§5.10). Runs on *both* projects — desktop and mobile — since the tray is meant to show
 * up wherever the clock/name rows do, following `game.spec.ts`'s host/guest setup verbatim
 * through `start-game-button`.
 */
test('a real capture updates both players’ captured-piece tray and point differential', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestContext = await browser.newContext();
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

    await expect(hostPage.getByTestId('start-button')).toBeEnabled();
    await hostPage.getByTestId('start-button').click(); // LOBBY -> TEAM_SELECT

    await hostPage.locator('[data-testid="team-card"][data-username="alice"] [data-testid="move-left"]').click();
    await guestPage.locator('[data-testid="team-card"][data-username="bob"] [data-testid="move-right"]').click();
    await hostPage.locator('[data-testid="team-card"][data-username="alice"] [data-testid="ready-toggle"]').click();
    await guestPage.locator('[data-testid="team-card"][data-username="bob"] [data-testid="ready-toggle"]').click();
    await expect(hostPage.getByTestId('start-game-button')).toBeEnabled();
    await hostPage.getByTestId('start-game-button').click(); // TEAM_SELECT -> IN_GAME

    const hostFen = hostPage.getByTestId('fen');
    const guestFen = guestPage.getByTestId('fen');
    await expect(hostFen).toBeVisible();
    await expect(guestFen).toBeVisible();

    // Before any capture, neither tray has anything to show.
    await expect(hostPage.getByTestId('captured-tray-b')).toHaveCount(0);
    await expect(hostPage.getByTestId('captured-tray-w')).toHaveCount(0);

    // 1. e4 d5 2. exd5 — White (host, alice) takes Black's d-pawn.
    await tapSquare(hostPage, 'e2');
    await tapSquare(hostPage, 'e4');
    await expect(hostFen).toContainText(' b ');

    await tapSquare(guestPage, 'd7');
    await tapSquare(guestPage, 'd5');
    await expect(hostFen).toContainText(' w ');

    await tapSquare(hostPage, 'e4');
    await tapSquare(hostPage, 'd5');
    await expect(hostFen).toContainText(' b ');
    await expect(guestFen).toContainText(' b ');

    // `captured-tray-b` (a captured *black* pawn) is the one that appears — testid keys off the
    // captured piece's own color, so it lands on the same locator regardless of which side of the
    // board (top/bottom row) it renders in for a given viewer's orientation. White is up a pawn,
    // so only the White-side advantage badge renders (`Math.max(0, ...)` keeps the loser's at 0).
    await expect(hostPage.getByTestId('captured-tray-b')).toContainText('♟'); // filled black pawn glyph
    await expect(hostPage.getByTestId('material-advantage-b')).toHaveText('+1');
    await expect(hostPage.getByTestId('captured-tray-w')).toHaveCount(0);

    await expect(guestPage.getByTestId('captured-tray-b')).toContainText('♟');
    await expect(guestPage.getByTestId('material-advantage-b')).toHaveText('+1');
    await expect(guestPage.getByTestId('captured-tray-w')).toHaveCount(0);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
