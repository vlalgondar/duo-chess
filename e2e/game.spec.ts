import { expect, test } from '@playwright/test';
import { tapSquare } from './helpers.js';

test('two contexts play four scripted moves and both boards match', async ({ browser }) => {
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
    await hostPage.getByTestId('start-button').click();

    const hostFen = hostPage.getByTestId('fen');
    const guestFen = guestPage.getByTestId('fen');
    await expect(hostFen).toBeVisible();
    await expect(guestFen).toBeVisible();

    // Host (white, host seat) opens 1. e4
    await tapSquare(hostPage, 'e2');
    await tapSquare(hostPage, 'e4');
    await expect(hostFen).toContainText(' b ');
    await expect(guestFen).toContainText(' b ');

    // Guest (black) replies 1... e5
    await tapSquare(guestPage, 'e7');
    await tapSquare(guestPage, 'e5');
    await expect(hostFen).toContainText(' w ');
    await expect(guestFen).toContainText(' w ');

    // 2. Nf3
    await tapSquare(hostPage, 'g1');
    await tapSquare(hostPage, 'f3');
    await expect(hostFen).toContainText(' b ');
    await expect(guestFen).toContainText(' b ');

    // 2... Nc6
    await tapSquare(guestPage, 'b8');
    await tapSquare(guestPage, 'c6');
    await expect(hostFen).toContainText(' w ');
    await expect(guestFen).toContainText(' w ');

    const finalFen = await hostFen.textContent();
    expect(finalFen).toBeTruthy();
    await expect(guestFen).toHaveText(finalFen ?? '');
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
