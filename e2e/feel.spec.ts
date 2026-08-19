import { expect, test, type Page } from '@playwright/test';
import { tapSquare } from './helpers.js';

/**
 * Drives two already-open contexts from `LOBBY` into a running 1v1 `IN_GAME` with the default
 * (clocked) time control — the same T-17 team-select script `game.spec.ts` uses, copied rather
 * than shared per this codebase's existing per-spec-file convention (see T-26's done-note).
 */
async function setupOneVOneGame(hostPage: Page, guestPage: Page): Promise<string> {
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

  await expect(hostPage.getByTestId('team-select-shell')).toBeVisible();
  await expect(guestPage.getByTestId('team-select-shell')).toBeVisible();

  await hostPage.locator('[data-testid="team-card"][data-username="alice"] [data-testid="move-left"]').click();
  await guestPage.locator('[data-testid="team-card"][data-username="bob"] [data-testid="move-right"]').click();
  await expect(
    hostPage.locator('[data-testid="team-panel-white"] [data-testid="team-card"][data-username="alice"]'),
  ).toBeVisible();
  await expect(
    guestPage.locator('[data-testid="team-panel-black"] [data-testid="team-card"][data-username="bob"]'),
  ).toBeVisible();

  await hostPage.locator('[data-testid="team-card"][data-username="alice"] [data-testid="ready-toggle"]').click();
  await guestPage.locator('[data-testid="team-card"][data-username="bob"] [data-testid="ready-toggle"]').click();
  await expect(hostPage.getByTestId('start-game-button')).toBeEnabled();
  await hostPage.getByTestId('start-game-button').click(); // TEAM_SELECT -> IN_GAME

  await expect(hostPage.getByTestId('fen')).toBeVisible();
  await expect(guestPage.getByTestId('fen')).toBeVisible();
  return code;
}

/** Fakes the Page Visibility API without relying on real OS-level tab backgrounding, which
 * Playwright's multi-context model doesn't reproduce — same technique used to unit-test
 * `visibilitychange` handlers in browsers generally: shadow the (otherwise non-configurable)
 * prototype getter with an own property, then fire the event by hand. */
async function setPageVisibility(page: Page, state: 'visible' | 'hidden'): Promise<void> {
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test.describe('polish pass (T-27)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'this spec covers desktop-only affordances (hover dots, RTT corner indicator) plus the shared clock-resync mechanism');
  });

  test('backgrounding and restoring a context resyncs the clock to within 250ms of the server value', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
      await setupOneVOneGame(hostPage, guestPage);

      // §4.6: "idle until White's first commit" — the clock doesn't actually run at all until
      // someone moves, so there'd be nothing to freeze/resync without this.
      await tapSquare(hostPage, 'e2');
      await tapSquare(hostPage, 'e4');
      await expect(hostPage.getByTestId('fen')).toContainText(' b ');

      const blackMs = hostPage.getByTestId('clock-ms-black');
      await expect(blackMs).toBeVisible();

      // Hide first, *then* read — reading before hiding would leave a race window (an
      // in-flight `requestAnimationFrame` tick between the read and the hide dispatch) where
      // the "frozen" value wouldn't match a value captured moments earlier for unrelated
      // reasons. Reading immediately after the (synchronous) hide dispatch has no such gap.
      const hiddenAt = Date.now();
      await setPageVisibility(hostPage, 'hidden');
      const frozenValue = Number(await blackMs.textContent());
      expect(Number.isFinite(frozenValue)).toBe(true);

      await hostPage.waitForTimeout(1200);

      // §5.10/§9: "stop the animation loop" while backgrounded — the display must not keep
      // counting down on its own; it stays frozen until visibility (and the loop) return.
      const stillFrozen = Number(await blackMs.textContent());
      expect(stillFrozen).toBe(frozenValue);

      await setPageVisibility(hostPage, 'visible');
      await expect.poll(async () => Number(await blackMs.textContent()), { timeout: 2000 }).not.toBe(frozenValue);

      const after = Number(await blackMs.textContent());
      const elapsedMs = Date.now() - hiddenAt;
      const expected = frozenValue - elapsedMs;

      expect(Math.abs(after - expected)).toBeLessThanOrEqual(250);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test('an RTT indicator appears once the ping/pong round trip completes', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
      await setupOneVOneGame(hostPage, guestPage);

      const indicator = hostPage.getByTestId('rtt-indicator');
      await expect(indicator).toBeVisible();
      await expect(indicator).toHaveAttribute('data-level', /green|yellow|red/);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test('the sound toggle is mutable and persists across a reload', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
      await setupOneVOneGame(hostPage, guestPage);

      const toggle = hostPage.getByTestId('sound-toggle');
      await expect(toggle).toBeVisible();
      const initial = await toggle.getAttribute('aria-pressed');

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', initial === 'true' ? 'false' : 'true');

      await hostPage.reload();
      // A reload drops the room connection; the toggle itself (Home screen has no game to
      // rejoin without a saved session) still reflects the persisted preference regardless of
      // screen, so read `localStorage` directly rather than re-driving the whole join flow.
      const persisted = await hostPage.evaluate(() => window.localStorage.getItem('duo-chess:sound-enabled'));
      expect(persisted).toBe(initial === 'true' ? 'false' : 'true');
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test('hovering a piece on desktop shows low-opacity legal-move dots without selecting it', async ({ page }) => {
    await page.goto('/?fen=' + encodeURIComponent('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
    await expect(page.getByTestId('board')).toBeVisible();

    await expect(page.getByTestId('legal-dot-hover')).toHaveCount(0);

    await page.locator('[data-square="b1"]').hover();
    await expect(page.getByTestId('legal-dot-hover')).toHaveCount(2);
    // Hovering alone must not select the piece — no click-selection dots, and the FEN is untouched.
    await expect(page.getByTestId('legal-dot')).toHaveCount(0);

    await page.locator('[data-square="a1"]').hover();
    await expect(page.getByTestId('legal-dot-hover')).toHaveCount(0);
  });
});
