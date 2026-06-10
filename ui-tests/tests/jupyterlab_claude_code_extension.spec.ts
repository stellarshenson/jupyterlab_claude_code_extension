import { expect, test } from '@jupyterlab/galata';

/**
 * Don't load JupyterLab webpage before running the tests.
 * This is required to ensure we capture all log messages.
 */
test.use({ autoGoto: false });

test('should emit an activation console message', async ({ page }) => {
  const logs: string[] = [];

  page.on('console', message => {
    logs.push(message.text());
  });

  await page.goto();

  // Activation either registers the panel or logs that the claude binary
  // is missing (CI runners do not have claude installed). Either path
  // proves the extension activated.
  const activated = logs.some(
    s =>
      s.includes('[jupyterlab_claude_code_extension] panel registered') ||
      s.includes('[jupyterlab_claude_code_extension] `claude` binary not found')
  );
  expect(activated).toBe(true);
});

/**
 * The test server config puts a fake `claude` script on PATH, so the panel
 * registers and the launch-terminal endpoint can spawn a real pty running
 * that script.
 */
test('plus button opens the new-session menu', async ({ page }) => {
  await page.goto();
  await page.sidebar.openTab('jupyterlab-claude-code-extension');

  const panel = page.locator('#jupyterlab-claude-code-extension');
  await expect(panel).toBeVisible();

  await panel
    .locator('button[title="New Claude session in the current folder"]')
    .click();

  const menu = page.locator('.lm-Menu.jp-ClaudeSessionsContextMenu');
  await expect(menu).toBeVisible();
  await expect(
    menu.locator('.lm-Menu-itemLabel', { hasText: 'New Claude Session' })
  ).toHaveCount(2);
  await expect(
    menu.locator('.lm-Menu-itemLabel', {
      hasText: 'New Claude Session (Skip Permissions)'
    })
  ).toHaveCount(1);
});

test('new-session menu item opens a terminal in the current folder', async ({
  page
}) => {
  await page.goto();
  await page.sidebar.openTab('jupyterlab-claude-code-extension');

  const panel = page.locator('#jupyterlab-claude-code-extension');
  await panel
    .locator('button[title="New Claude session in the current folder"]')
    .click();

  const menu = page.locator('.lm-Menu.jp-ClaudeSessionsContextMenu');
  await menu
    .locator('.lm-Menu-itemLabel', {
      hasText: /^New Claude Session$/
    })
    .click();

  // The launch flow shows a modal spinner, POSTs launch-terminal (no
  // session_id -> new session), then attaches JL's terminal widget. The
  // pty runs the fake claude script directly - no shell prompt. xterm
  // paints to canvas so the script's output is not assertable via DOM
  // text; instead confirm the server now reports a live terminal session.
  const terminal = page.locator('.jp-Terminal');
  await expect(terminal).toBeVisible({ timeout: 30000 });

  const response = await page.request.get('/api/terminals');
  expect(response.ok()).toBe(true);
  const terminals = (await response.json()) as Array<{ name: string }>;
  expect(terminals.length).toBeGreaterThan(0);
});
