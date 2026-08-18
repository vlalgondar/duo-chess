import type { Locator, Page } from '@playwright/test';

export async function openPlayer(page: Page, username: string, code: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('username-input').fill(username);
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('join-button').click();
}

/**
 * `react-chessboard` (T-11) drags pieces via native HTML5 drag-and-drop (`react-dnd`'s
 * `HTML5Backend`), which `Locator.dragTo()` can't drive — it only simulates a mouse
 * down/move/up sequence, and Chromium's native DnD needs an actual `dragstart`/`dragover`/`drop`
 * event sequence with a shared `DataTransfer` to recognize it as a drag at all. The waits
 * between stages are load-bearing, not padding: `react-dnd`'s internal drag-source/monitor
 * state updates asynchronously, and dispatching the next event before that settles makes the
 * drop resolve against the wrong (or no) target — confirmed empirically, not a guess.
 */
export async function dragPiece(page: Page, from: string, to: string): Promise<void> {
  const targetBox = await page.locator(`[data-square="${to}"]`).boundingBox();
  if (!targetBox) throw new Error(`drop target square "${to}" not found`);
  const clientX = targetBox.x + targetBox.width / 2;
  const clientY = targetBox.y + targetBox.height / 2;

  await page.evaluate(
    async ({ from, to, clientX, clientY }) => {
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const source = document.querySelector(`[data-square="${from}"] [data-piece]`);
      const target = document.querySelector(`[data-square="${to}"]`);
      if (!source || !target) throw new Error('drag source or target square not found');

      const dataTransfer = new DataTransfer();
      const fire = (element: Element, type: string) =>
        element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX, clientY, dataTransfer }));

      fire(source, 'dragstart');
      await wait(150);
      fire(target, 'dragenter');
      await wait(150);
      fire(target, 'dragover');
      await wait(150);
      fire(target, 'drop');
      await wait(150);
      fire(source, 'dragend');
    },
    { from, to, clientX, clientY },
  );
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
