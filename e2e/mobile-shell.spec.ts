import { expect, test } from '@playwright/test';
import { boardBox, tapSquare } from './helpers.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function boardUrl(fen: string): string {
  return `/?fen=${encodeURIComponent(fen)}`;
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
