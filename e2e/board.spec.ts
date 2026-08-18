import { expect, test } from '@playwright/test';
import { dragPiece, legalDots, tapSquare } from './helpers.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function boardUrl(fen: string): string {
  return `/?fen=${encodeURIComponent(fen)}`;
}

test('clicking a starting knight shows exactly two dots, a starting rook shows none', async ({ page }) => {
  await page.goto(boardUrl(START_FEN));

  await tapSquare(page, 'b1'); // knight
  await expect(legalDots(page)).toHaveCount(2);

  await tapSquare(page, 'b1'); // deselect
  await tapSquare(page, 'a1'); // rook, blocked in
  await expect(legalDots(page)).toHaveCount(0);
});

test('en-passant and both castling targets appear as legal-move indicators', async ({ page }) => {
  // White king still has both rooks; black pawn just advanced two squares to d5, so e5xd6 e.p. is on.
  await page.goto(boardUrl('r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1'));

  await tapSquare(page, 'e1'); // king — castling both ways
  await expect(page.locator('[data-square="g1"] [data-testid="legal-dot"]')).toHaveCount(1);
  await expect(page.locator('[data-square="c1"] [data-testid="legal-dot"]')).toHaveCount(1);

  await tapSquare(page, 'e1'); // deselect
  await tapSquare(page, 'e5'); // pawn — en passant capture on d6
  await expect(page.locator('[data-square="d6"] [data-testid="legal-ring"]')).toHaveCount(1);
});

test('an illegal drag leaves the FEN unchanged', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drag uses react-dnd\'s HTML5 backend, which only wires up on non-touch clients');

  await page.goto(boardUrl(START_FEN));
  const fen = page.getByTestId('fen');
  const before = await fen.textContent();

  await dragPiece(page, 'b8', 'b6'); // knight can't move there

  await expect(fen).toHaveText(before ?? '');
});
