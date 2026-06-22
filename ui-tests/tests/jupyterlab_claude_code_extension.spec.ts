import { expect, test } from '@jupyterlab/galata';

/**
 * Don't load JupyterLab webpage before running the tests.
 * This is required to ensure we capture all log messages.
 */
test.use({ autoGoto: false });

/**
 * Build-agnostic readiness check.
 *
 * Galata's default `waitForApplication` calls `isInSimpleMode()`, which waits
 * on the status-bar single-document-mode toggle (`getByRole('switch', { name:
 * 'Simple' })`). Some JupyterLab builds do not render that toggle, so the
 * default check hangs and every test times out at `page.goto()`. Wait on the
 * splash teardown plus the lab shell instead - present in every build - so the
 * suite is robust to the toggle's absence.
 */
test.use({
  waitForApplication: async ({ baseURL }, use) => {
    void baseURL;
    const waitIsReady = async (page: any): Promise<void> => {
      await page.locator('#jupyterlab-splash').waitFor({ state: 'detached' });
      await page.locator('.jp-LabShell').first().waitFor({ state: 'visible' });
    };
    await use(waitIsReady);
  }
});

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

  // The launch flow shows a modal spinner, POSTs launch-terminal (a
  // frontend new_session_id -> a fresh claude --session-id <uuid>), then
  // attaches JL's terminal widget. The
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

/**
 * The server config seeds a project ("branchy") with three parallel
 * conversations, so the branch UI has something to act on. These tests drive
 * the new "Open Branched Conversation" submenu and the per-row Open button in
 * the Manage Sessions popup. The fake claude is a shell script (its process
 * comm is not "claude"), so the server's has_claude gate is off and every
 * open spawns a fresh terminal - which is exactly how independent branches
 * behave; the conversation-aware REUSE logic is covered by the unit tests.
 */

/** Right-click the seeded "branchy" row and return its context menu. */
async function openBranchyMenu(page: any) {
  await page.goto();
  await page.sidebar.openTab('jupyterlab-claude-code-extension');
  const panel = page.locator('#jupyterlab-claude-code-extension');
  await expect(panel).toBeVisible();
  const row = panel
    .locator('.jp-ClaudeSessionsPanel-row', { hasText: 'branchy' })
    .first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click({ button: 'right' });
  const menu = page.locator('.lm-Menu.jp-ClaudeSessionsContextMenu').first();
  await expect(menu).toBeVisible({ timeout: 15000 });
  return menu;
}

test('context menu offers Open Branched Conversation for a multi-branch project', async ({
  page
}) => {
  const menu = await openBranchyMenu(page);
  await expect(
    menu.locator('.lm-Menu-itemLabel', {
      hasText: 'Open Branched Conversation'
    })
  ).toBeVisible();
  // The switch submenu still coexists (Open alongside Switch).
  await expect(
    menu.locator('.lm-Menu-itemLabel', {
      hasText: 'Switch and Manage Sessions'
    })
  ).toBeVisible();
});

test('Open Branched Conversation lists branches and opening one launches a terminal', async ({
  page
}) => {
  const menu = await openBranchyMenu(page);
  await menu
    .locator('.lm-Menu-itemLabel', { hasText: 'Open Branched Conversation' })
    .hover();
  // Hovering the submenu opens a nested Lumino menu with the branch entries.
  const submenu = page.locator('.lm-Menu').last();
  const entries = submenu.locator('.lm-Menu-item[data-type="command"]');
  await expect(entries.first()).toBeVisible({ timeout: 10000 });
  await entries.first().click();

  // _openBranch -> launch-terminal (claude --resume <id>) -> JL terminal widget.
  await expect(page.locator('.jp-Terminal')).toBeVisible({ timeout: 30000 });
});

test('Manage Sessions popup exposes a per-row Open button', async ({
  page
}) => {
  const menu = await openBranchyMenu(page);
  await menu
    .locator('.lm-Menu-itemLabel', { hasText: 'Open Branched Conversation' })
    .hover();
  const submenu = page.locator('.lm-Menu').last();
  // Wait for the submenu to open, then click its "Manage Sessions..."
  // COMMAND item. The ``[data-type="command"]`` filter is essential -
  // ``hasText: 'Manage Sessions'`` alone also matches the "Switch and Manage
  // Sessions" submenu PARENT, which does not open the popup.
  await expect(
    submenu.locator('.lm-Menu-item[data-type="command"]').first()
  ).toBeVisible({ timeout: 10000 });
  await submenu
    .locator('.lm-Menu-item[data-type="command"]', {
      hasText: 'Manage Sessions'
    })
    .click();

  const popup = page.locator('.jp-ClaudeSessionsPanel-branchPopup');
  await expect(popup).toBeVisible({ timeout: 15000 });
  // Every row (current + branches) carries an Open button.
  const openButtons = popup.locator('.jp-ClaudeSessionsPanel-branchOpen');
  await expect(openButtons.first()).toBeVisible();
  const count = await openButtons.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Opening from the popup launches a terminal and dismisses the popup.
  await openButtons.first().click();
  await expect(page.locator('.jp-Terminal')).toBeVisible({ timeout: 30000 });
  await expect(popup).toBeHidden();
});

test('two different branches open as two independent terminals', async ({
  page
}) => {
  const before = (
    (await (await page.request.get('/api/terminals')).json()) as unknown[]
  ).length;

  // Open the first branch.
  let menu = await openBranchyMenu(page);
  await menu
    .locator('.lm-Menu-itemLabel', { hasText: 'Open Branched Conversation' })
    .hover();
  let submenu = page.locator('.lm-Menu').last();
  let entries = submenu.locator('.lm-Menu-item[data-type="command"]');
  await expect(entries.first()).toBeVisible({ timeout: 10000 });
  await entries.first().click();
  await expect(page.locator('.jp-Terminal').first()).toBeVisible({
    timeout: 30000
  });

  // Open a different branch - it must NOT replace the first terminal.
  menu = await openBranchyMenu(page);
  await menu
    .locator('.lm-Menu-itemLabel', { hasText: 'Open Branched Conversation' })
    .hover();
  submenu = page.locator('.lm-Menu').last();
  entries = submenu.locator('.lm-Menu-item[data-type="command"]');
  await expect(entries.nth(1)).toBeVisible({ timeout: 10000 });
  await entries.nth(1).click();
  await expect(page.locator('.jp-Terminal').first()).toBeVisible({
    timeout: 30000
  });

  const after = (
    (await (await page.request.get('/api/terminals')).json()) as unknown[]
  ).length;
  expect(after - before).toBeGreaterThanOrEqual(2);
});
