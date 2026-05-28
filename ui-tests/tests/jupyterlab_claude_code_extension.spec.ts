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
 * Regression test for 1.1.13 -> 1.1.14: the launch-spinner Dialog is
 * constructed with ``buttons: []`` so it has no default button for
 * ``Dialog.resolve()`` to "click". The spinner MUST be dismissed via
 * ``Dialog.dispose()`` from the ``finally`` block in
 * ``_doResumeInTerminal`` - otherwise the modal hangs over the panel
 * forever after the terminal opens.
 *
 * We force the panel to render by mocking ``/status`` so claude looks
 * installed, feed it one fake session via ``/sessions``, and stub
 * ``/launch-terminal`` so the request resolves without touching a real
 * terminal. The subsequent ``terminal:open`` will fail (the fake name is
 * not registered with jupyter_server's terminal manager) - that is fine
 * for this test: the spinner-dismiss is in ``finally`` and must run on
 * both the success and the error path.
 */
test('launch spinner dismisses after the terminal launch flow completes', async ({
  page
}) => {
  await page.route('**/jupyterlab-claude-code-extension/status', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        has_claude: true,
        root_dir: '/tmp',
        version: '0.0.0',
        running_sessions: []
      })
    })
  );

  await page.route('**/jupyterlab-claude-code-extension/sessions', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [
          {
            project_path: '/tmp/fake-project',
            session_id: 'fake-session-id',
            updated_at: Math.floor(Date.now() / 1000),
            message_count: 1,
            branch: null,
            live_pid: null,
            favorite: false,
            name: 'fake-project',
            name_source: 'basename'
          }
        ]
      })
    })
  );

  await page.route(
    '**/jupyterlab-claude-code-extension/launch-terminal',
    route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ terminal_name: 'fake-terminal' })
      })
  );

  await page.goto();

  // Bring the Claude Sessions panel to the foreground. ``activateById``
  // is the labShell entry point; the id is set in widget.ts.
  await page.evaluate(() => {
    const app: any = (globalThis as any).jupyterapp;
    app.shell.activateById('jupyterlab-claude-code-extension');
  });

  // Wait for the row to render, then click it - this triggers
  // ``_doResumeInTerminal`` which opens the spinner.
  const row = await page.waitForSelector('.jp-ClaudeSessionsPanel-row', {
    timeout: 10000
  });
  await row.click();

  // The spinner Dialog should appear, identified by its title.
  await page.waitForSelector(
    '.jp-Dialog-header:has-text("Opening Claude Code session")',
    { timeout: 5000 }
  );

  // And then dismiss within a couple of seconds once the mocked launch
  // flow returns - dispose() must close it even though there are no
  // buttons. If someone reintroduces ``spinner.resolve()`` this assertion
  // fails (resolve is a no-op without buttons).
  await page.waitForSelector(
    '.jp-Dialog-header:has-text("Opening Claude Code session")',
    { state: 'detached', timeout: 5000 }
  );

  // Sanity check - no stray .jp-Dialog left behind.
  expect(await page.locator('.jp-Dialog').count()).toBe(0);
});
