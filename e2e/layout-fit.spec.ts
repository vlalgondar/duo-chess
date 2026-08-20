import { expect, test } from '@playwright/test';
import { boardBox, openPlayer } from './helpers.js';

/**
 * Desktop-only geometry: both the in-game and post-game screens must fit a single screen with
 * no page scroll at >=900px, and the board is meant to actually be bigger than before this pass
 * (old flat caps: 560px in-game, 420px post-game). See `GameScreen.tsx`'s and `ResultScreen.tsx`'s
 * `BOARD_SIZE_CLASSNAME` comments for the chrome tally these assertions are checking against.
 */
test.describe('desktop layout fits one screen without shrinking the board', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'this spec covers the >=900px desktop layout only');
  });

  async function fitsWithoutScroll(page: import('@playwright/test').Page): Promise<void> {
    const overflow = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight + 1);
  }

  test('the game screen fits at 1280x720 and 1440x900, with the board bigger than the old 560px cap', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
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

      await hostPage.locator('[data-testid="team-card"][data-username="alice"] [data-testid="move-left"]').click();
      await guestPage.locator('[data-testid="team-card"][data-username="bob"] [data-testid="move-right"]').click();
      await hostPage.locator('[data-testid="team-card"][data-username="alice"] [data-testid="ready-toggle"]').click();
      await guestPage.locator('[data-testid="team-card"][data-username="bob"] [data-testid="ready-toggle"]').click();
      await expect(hostPage.getByTestId('start-game-button')).toBeEnabled();
      await hostPage.getByTestId('start-game-button').click(); // TEAM_SELECT -> IN_GAME

      await expect(hostPage.getByTestId('game-shell')).toBeVisible();
      await fitsWithoutScroll(hostPage);

      // A tall monitor is where the raised 720px cap (was 560px) actually matters — the
      // deduction alone doesn't prove the cap moved.
      await hostPage.setViewportSize({ width: 1440, height: 900 });
      await fitsWithoutScroll(hostPage);
      const box = await boardBox(hostPage);
      expect(box.height).toBeGreaterThan(560);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test('the result screen fits at 1280x720 with Rematch and Leave fully visible, board bigger than the old 420px cap', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
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

      await hostPage.locator('[data-testid="team-card"][data-username="alice"] [data-testid="move-left"]').click();
      await guestPage.locator('[data-testid="team-card"][data-username="bob"] [data-testid="move-right"]').click();
      await hostPage.locator('[data-testid="team-card"][data-username="alice"] [data-testid="ready-toggle"]').click();
      await guestPage.locator('[data-testid="team-card"][data-username="bob"] [data-testid="ready-toggle"]').click();
      await expect(hostPage.getByTestId('start-game-button')).toBeEnabled();
      await hostPage.getByTestId('start-game-button').click(); // TEAM_SELECT -> IN_GAME

      await expect(hostPage.getByTestId('resign-button')).toBeVisible();
      // Solo team (1v1) — Resign is immediate, behind a confirm dialog (same as leave.spec.ts).
      hostPage.once('dialog', (dialog) => dialog.accept());
      await hostPage.getByTestId('resign-button').click();

      await expect(hostPage.getByTestId('result-banner')).toBeVisible();
      await fitsWithoutScroll(hostPage);

      const box = await boardBox(hostPage);
      expect(box.height).toBeGreaterThan(420);

      for (const testId of ['rematch-button', 'leave-button']) {
        const button = await hostPage.getByTestId(testId).boundingBox();
        if (!button) throw new Error(`${testId} bounding box unavailable`);
        expect(button.y).toBeGreaterThanOrEqual(0);
        expect(button.y + button.height).toBeLessThanOrEqual(720);
        expect(button.x).toBeGreaterThanOrEqual(0);
        expect(button.x + button.width).toBeLessThanOrEqual(1280);
      }
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
});

test.describe('the Join room button signals a complete room code', () => {
  test('stays the secondary/disabled style until the 6th character, then turns the accent variant on', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('username-input').fill('alice');

    const joinButton = page.getByTestId('join-button');
    const codeInput = page.getByTestId('code-input');

    // Asserting on the class list rather than `getComputedStyle`'s `backgroundColor`: the button
    // has `transition-colors`, so a color read taken immediately after the class swap can catch
    // the transition mid-flight rather than its settled end state.
    await codeInput.fill('K7P2Q'); // 5 of 6 chars
    await expect(joinButton).toBeDisabled();
    await expect(joinButton).toHaveClass(/bg-surface-2/);
    await expect(joinButton).not.toHaveClass(/bg-accent\b/);

    await codeInput.fill('K7P2QX'); // 6th char completes the code
    await expect(joinButton).toBeEnabled();
    await expect(joinButton).toHaveClass(/bg-accent\b/);
    await expect(joinButton).not.toHaveClass(/bg-surface-2/);
  });
});
