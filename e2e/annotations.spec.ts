import { expect, test, type Page } from '@playwright/test';
import { dragPiece, drawAnnotation, tapSquare } from './helpers.js';

// Same precedent as `proposal-ui.spec.ts`: Chromium's `isMobile` emulation anchors the bottom
// sheet against a phantom collapsible-toolbar viewport, positioning `accept-button` outside
// Playwright's own coordinate space even though it renders correctly. Real-device mobile layout
// is T-12's own Deferred scope; this spec's job is the annotation logic, already exercised on
// desktop.
function skipOnMobileToolbarQuirk(isMobile: boolean) {
  test.skip(isMobile, "Chromium mobile-emulation's fixed-position viewport quirk, not a real bug — see comment above");
}

function visibleTestId(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`);
}

function teamCard(page: Page, username: string, action: 'move-left' | 'move-right' | 'ready-toggle') {
  return page.locator(`[data-testid="team-card"][data-username="${username}"] [data-testid="${action}"]`);
}

test('board annotations: teammate-only, off-turn, non-blocking overlay, cleared on commit', async ({
  browser,
  isMobile,
}) => {
  skipOnMobileToolbarQuirk(isMobile);

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const carolContext = await browser.newContext();
  const daveContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const carolPage = await carolContext.newPage();
  const davePage = await daveContext.newPage();
  const allPages = [alicePage, bobPage, carolPage, davePage];

  try {
    await alicePage.goto('/');
    await alicePage.getByTestId('username-input').fill('alice');
    await alicePage.getByTestId('create-room-button').click();
    const code = (await alicePage.getByTestId('room-code').textContent())?.trim();
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

    await expect(alicePage.getByTestId('roster-item')).toHaveCount(4);
    await alicePage.getByTestId('start-button').click(); // LOBBY -> TEAM_SELECT
    for (const page of allPages) await expect(page.getByTestId('team-select-shell')).toBeVisible();

    // WHITE: alice + carol. BLACK: bob + dave.
    await teamCard(alicePage, 'alice', 'move-left').click();
    await teamCard(carolPage, 'carol', 'move-left').click();
    await teamCard(bobPage, 'bob', 'move-right').click();
    await teamCard(davePage, 'dave', 'move-right').click();
    await expect(alicePage.locator('[data-testid="team-panel-white"] [data-testid="team-card"]')).toHaveCount(2);
    await expect(alicePage.locator('[data-testid="team-panel-black"] [data-testid="team-card"]')).toHaveCount(2);

    for (const [page, username] of [
      [alicePage, 'alice'],
      [bobPage, 'bob'],
      [carolPage, 'carol'],
      [davePage, 'dave'],
    ] as const) {
      await teamCard(page, username, 'ready-toggle').click();
    }
    await expect(alicePage.getByTestId('start-game-button')).toBeEnabled();
    await alicePage.getByTestId('start-game-button').click(); // TEAM_SELECT -> IN_GAME
    for (const page of allPages) await expect(page.getByTestId('game-shell')).toBeVisible();

    const fens = allPages.map((page) => page.getByTestId('fen'));

    // 1. e4 — WHITE moves (alice proposes, carol accepts), so it's now BLACK's turn.
    await tapSquare(alicePage, 'e2');
    await tapSquare(alicePage, 'e4');
    await visibleTestId(carolPage, 'accept-button').click();
    for (const fen of fens) await expect(fen).toContainText(' b ');

    // While it's the *opponent's* turn (WHITE, alice+carol, is locked off-turn), alice draws a
    // circle on e5 — the square black is about to move to. Annotations stay live off-turn
    // (§5.5), and are team-scoped like proposals: carol (teammate) sees it, bob/dave (opponents)
    // never do.
    await drawAnnotation(alicePage, 'e5', 'e5');
    await expect(carolPage.getByTestId('annotation-circle')).toBeVisible();
    await expect(bobPage.getByTestId('annotation-circle')).toHaveCount(0);
    await expect(davePage.getByTestId('annotation-circle')).toHaveCount(0);

    // The overlay is rendered `pointer-events: none` — verify directly, not just by inference.
    await expect(carolPage.getByTestId('annotation-overlay')).toHaveCSS('pointer-events', 'none');

    // A real piece drag landing exactly on the annotated square (e5) still works — the overlay
    // never intercepts it. Bob proposes 1... e5, dave accepts, committing the move.
    await dragPiece(bobPage, 'e7', 'e5');
    await visibleTestId(davePage, 'accept-button').click();
    for (const fen of fens) await expect(fen).toContainText(' w ');

    // That commit clears annotations for both teams — alice/carol's circle on e5 is gone.
    await expect(carolPage.getByTestId('annotation-overlay')).toHaveCount(0);
    await expect(alicePage.getByTestId('annotation-overlay')).toHaveCount(0);
  } finally {
    await aliceContext.close();
    await bobContext.close();
    await carolContext.close();
    await daveContext.close();
  }
});
