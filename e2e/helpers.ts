import type { Locator, Page } from '@playwright/test';

export async function openPlayer(page: Page, username: string, code: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('username-input').fill(username);
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('join-button').click();
}

/**
 * Forward-declared for T-11 (board) and T-12 (mobile shell), which don't
 * exist yet. These assume the square-addressing convention the board
 * component will need to implement: a `data-testid="board"` container and
 * one `[data-square="<square>"]` element per square (e.g. `e4`), plus a
 * `data-testid="legal-dot"` on each legal-move indicator. Unexercised by
 * T-05's own spec — adjust here if the board lands with a different
 * contract.
 */
export async function dragPiece(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).dragTo(page.locator(`[data-square="${to}"]`));
}

export async function tapSquare(page: Page, square: string): Promise<void> {
  await page.locator(`[data-square="${square}"]`).click();
}

export function legalDots(page: Page): Locator {
  return page.getByTestId('legal-dot');
}

export async function boardBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('board').boundingBox();
  if (!box) throw new Error('board bounding box unavailable — is the board mounted?');
  return box;
}
