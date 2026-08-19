import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { boardBox, tapSquare } from './helpers.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function boardUrl(fen: string): string {
  return `/?fen=${encodeURIComponent(fen)}`;
}

/**
 * A real networked 1v1 game (`?fen=` is `BoardScreen`'s local sandbox — no `VoteActions`
 * exists there), following `game.spec.ts`'s host/guest setup verbatim through `start-game-button`.
 * Both teams are solo, so `VoteActions` renders Resign directly with no teammate-agreement step —
 * the simplest state that reproduces the bug, at half the contexts of a 2v2 setup.
 */
async function startSoloGame(browser: Browser): Promise<{
  hostContext: BrowserContext;
  guestContext: BrowserContext;
  hostPage: Page;
}> {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();

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

  await expect(hostPage.getByTestId('fen')).toBeVisible();
  return { hostContext, guestContext, hostPage };
}

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, 'mobile shell geometry only applies below the 900px breakpoint');
});

test('the board stays within the viewport at 390x844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(boardUrl(START_FEN));

  const box = await boardBox(page);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
});

test('the board stays within the viewport at 390x750 (collapsed toolbar)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 750 });
  await page.goto(boardUrl(START_FEN));

  const box = await boardBox(page);
  expect(box.y + box.height).toBeLessThanOrEqual(750);
});

test('tap-tap moves a pawn', async ({ page }) => {
  await page.goto(boardUrl(START_FEN));
  const fen = page.getByTestId('fen');
  const before = await fen.textContent();

  await tapSquare(page, 'e2');
  await tapSquare(page, 'e4');

  await expect(fen).not.toHaveText(before ?? '');
  await expect(fen).toContainText('4P3');
});

test('Accept and Reject bounding boxes are at least 44px in both dimensions', async ({ page }) => {
  await page.goto(boardUrl(START_FEN));

  const sheet = page.getByTestId('bottom-sheet');
  const accept = await sheet.getByTestId('accept-button').boundingBox();
  const reject = await sheet.getByTestId('reject-button').boundingBox();
  if (!accept || !reject) throw new Error('Accept/Reject bounding box unavailable');

  expect(accept.width).toBeGreaterThanOrEqual(44);
  expect(accept.height).toBeGreaterThanOrEqual(44);
  expect(reject.width).toBeGreaterThanOrEqual(44);
  expect(reject.height).toBeGreaterThanOrEqual(44);
});

test("the sheet's peeked height leaves the board fully visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(boardUrl(START_FEN));

  const board = await boardBox(page);
  const sheet = await page.getByTestId('bottom-sheet').boundingBox();
  if (!sheet) throw new Error('bottom sheet bounding box unavailable');

  expect(await page.getByTestId('bottom-sheet').getAttribute('data-expanded')).toBe('false');
  expect(board.y + board.height).toBeLessThanOrEqual(sheet.y);
});

for (const viewport of [
  { width: 390, height: 844 }, // fits without scrolling — baseline sanity check
  { width: 390, height: 650 }, // short phone (empirically: an iPhone-SE-class dvh forces
  // enough scroll to clear the fixed bottom sheet that the pre-fix header, including
  // Resign, scrolled off the top edge entirely — verified by measuring the unfixed
  // layout directly, not guessed)
]) {
  test(`Resign stays reachable at ${viewport.width}x${viewport.height}, including scrolled to clear the sheet`, async ({
    browser,
  }) => {
    const { hostContext, guestContext, hostPage } = await startSoloGame(browser);
    try {
      await hostPage.setViewportSize(viewport);

      const resign = hostPage.getByTestId('resign-button');
      await expect(resign).toBeVisible();
      const box = await resign.boundingBox();
      if (!box) throw new Error('resign button bounding box unavailable');
      expect(box.height).toBeGreaterThanOrEqual(44); // CLAUDE.md rule 9

      // The resting position a phone player actually reaches: scrolled down to clear the
      // fixed bottom sheet off the board. This is the scroll position that used to carry
      // the header — including Resign — off the top edge with it.
      await hostPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(resign).toBeInViewport({ ratio: 1 });

      // And nothing covers it — hit-test the center, not just the bounding box.
      const clickable = await resign.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      });
      expect(clickable).toBe(true);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
}
