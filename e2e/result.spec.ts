import { Chess } from 'chess.js';
import { expect, test, type Page } from '@playwright/test';
import { tapSquare } from './helpers.js';

/**
 * See `proposal-ui.spec.ts`'s own comment for why the "both layouts coexist in the DOM,
 * CSS-only show/hide" precedent (T-12) makes an unscoped `getByTestId` ambiguous.
 */
function visibleTestId(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`);
}

function teamCard(page: Page, username: string, action: 'move-left' | 'move-right' | 'ready-toggle') {
  return page.locator(`[data-testid="team-card"][data-username="${username}"] [data-testid="${action}"]`);
}

test('T-26: result banner, PGN copy, and rematch for all four seats', async ({ browser, isMobile }) => {
  // Same Chromium mobile-emulation fixed-position quirk `proposal-ui.spec.ts` already
  // documents and skips for — this test drives the same 2v2 bottom-sheet team panel.
  test.skip(isMobile, "Chromium mobile-emulation's fixed-position viewport quirk, not a real bug — see proposal-ui.spec.ts");

  const aliceContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
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

    for (const page of allPages) {
      await expect(page.getByTestId('team-select-shell')).toBeVisible();
    }

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

    for (const page of allPages) {
      await expect(page.getByTestId('game-shell')).toBeVisible();
    }

    // Fool's Mate: 1. f3 e5 2. g4 Qh4# — same script `proposal-ui.spec.ts` and the
    // server's own `game.test.ts` harness case use, so BLACK wins by checkmate.
    await tapSquare(alicePage, 'f2');
    await tapSquare(alicePage, 'f3');
    await visibleTestId(carolPage, 'accept-button').click();

    await tapSquare(bobPage, 'e7');
    await tapSquare(bobPage, 'e5');
    await visibleTestId(davePage, 'accept-button').click();

    await tapSquare(carolPage, 'g2');
    await tapSquare(carolPage, 'g4');
    await expect(visibleTestId(alicePage, 'accept-button')).toBeEnabled({ timeout: 1000 });
    await visibleTestId(alicePage, 'accept-button').click();

    await tapSquare(davePage, 'd8');
    await tapSquare(davePage, 'h4');
    await visibleTestId(bobPage, 'accept-button').click();

    // Banner names the winner and reason, for every seat.
    for (const page of allPages) {
      await expect(page.getByTestId('result-banner')).toContainText('BLACK wins');
      await expect(page.getByTestId('result-banner')).toContainText('Checkmate');
    }

    // Move list: 1. f3 e5  2. g4 Qh4#
    const moveRows = alicePage.getByTestId('move-row');
    await expect(moveRows).toHaveCount(2);
    await expect(moveRows.nth(0)).toContainText('f3');
    await expect(moveRows.nth(0)).toContainText('e5');
    await expect(moveRows.nth(1)).toContainText('g4');
    await expect(moveRows.nth(1)).toContainText('Qh4#');

    // PGN copy: parseable by chess.js and replays to the displayed final position.
    const finalFen = await alicePage.getByTestId('fen').textContent();
    if (!finalFen) throw new Error('final FEN was not rendered on the result screen');

    await alicePage.getByTestId('pgn-copy-button').click();
    const pgn = await alicePage.evaluate(() => navigator.clipboard.readText());
    const replay = new Chess();
    replay.loadPgn(pgn);
    expect(replay.fen()).toBe(finalFen);

    // Rematch (triggered by a non-host player, bob) returns every seat to team select,
    // with teams and settings retained.
    await bobPage.getByTestId('rematch-button').click();
    for (const page of allPages) {
      await expect(page.getByTestId('team-select-shell')).toBeVisible();
    }
    await expect(alicePage.locator('[data-testid="team-panel-white"] [data-testid="team-card"]')).toHaveCount(2);
    await expect(alicePage.locator('[data-testid="team-panel-black"] [data-testid="team-card"]')).toHaveCount(2);
  } finally {
    await aliceContext.close();
    await bobContext.close();
    await carolContext.close();
    await daveContext.close();
  }
});
