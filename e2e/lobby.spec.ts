import { expect, test } from '@playwright/test';

test('host creates a room, a guest joins via the deep link, and Start gates on player count', async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();

  try {
    await hostPage.goto('/');
    await hostPage.getByTestId('username-input').fill('alice');
    await hostPage.getByTestId('create-room-button').click();

    await expect(hostPage.getByTestId('roster-item')).toHaveCount(1);
    await expect(hostPage.getByTestId('start-button')).toBeDisabled();

    const code = (await hostPage.getByTestId('room-code').textContent())?.trim();
    if (!code) throw new Error('room code was not rendered in the lobby');

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(`/join/${code}`);
      await expect(guestPage.getByTestId('code-input')).toHaveValue(code);

      await guestPage.getByTestId('username-input').fill('bob');
      await guestPage.getByTestId('join-button').click();

      await expect(hostPage.getByTestId('roster-item')).toHaveCount(2);
      await expect(guestPage.getByTestId('roster-item')).toHaveCount(2);
      await expect(hostPage.getByTestId('roster')).toContainText('alice');
      await expect(hostPage.getByTestId('roster')).toContainText('bob');

      await expect(hostPage.getByTestId('start-button')).toBeEnabled();
    } finally {
      await guestContext.close();
    }
  } finally {
    await hostContext.close();
  }
});
