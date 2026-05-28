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
 * We rather than exercising the full backend, we drive the spinner
 * directly through the widget's private API once the panel is mounted.
 * The mocked ``/status`` makes the panel register on CI runners that
 * have no ``claude`` binary; the spinner is then opened and disposed
 * exactly the way ``_doResumeInTerminal``'s ``try/finally`` does.
 */
test('launch spinner dialog must be dismissable via dispose()', async ({
  page
}) => {
  await page.route('**/jupyterlab-claude-code-extension/status', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true,
        claude_path: '/usr/local/bin/claude',
        root_dir: '/tmp'
      })
    })
  );

  await page.route('**/jupyterlab-claude-code-extension/sessions', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [] })
    })
  );

  await page.goto();

  // Wait for the panel's DOM node to exist - this only happens once the
  // extension's async ``activate()`` has finished awaiting ``/status``
  // and called ``labShell.add(widget, ...)``. Lumino sets the side-stack
  // container's id to the widget id, so ``#jupyterlab-claude-code-extension``
  // becomes a stable readiness signal that the panel is registered.
  await page.waitForSelector('#jupyterlab-claude-code-extension', {
    state: 'attached',
    timeout: 15000
  });

  // Drive ``_showLaunchSpinner`` directly off the registered widget
  // instance and stash the returned Dialog on ``window`` so a second
  // evaluate can dispose it. This mirrors the exact try/finally pattern
  // in ``_doResumeInTerminal``.
  await page.evaluate(() => {
    const app: any = (window as any).jupyterapp;
    let panel: any = null;
    for (const area of ['left', 'right']) {
      const it = app.shell.widgets(area);
      const widgets = typeof it[Symbol.iterator] === 'function' ? it : null;
      if (widgets) {
        for (const w of widgets) {
          if (w.id === 'jupyterlab-claude-code-extension') {
            panel = w;
            break;
          }
        }
      }
      if (panel) {
        break;
      }
    }
    if (!panel) {
      throw new Error('panel widget not found in left/right sidebars');
    }
    (window as any).__claudeSpinner = panel._showLaunchSpinner();
  });

  // The spinner Dialog should appear, identified by its title.
  await page.waitForSelector(
    '.jp-Dialog-header:has-text("Opening Claude Code session")',
    { timeout: 5000 }
  );

  // ``dispose()`` MUST detach it. If someone reintroduces
  // ``spinner.resolve()`` the dialog would still be attached after the
  // call (resolve is a no-op without buttons) and the next waitForSelector
  // would time out.
  await page.evaluate(() => {
    (window as any).__claudeSpinner.dispose();
  });

  await page.waitForSelector(
    '.jp-Dialog-header:has-text("Opening Claude Code session")',
    { state: 'detached', timeout: 5000 }
  );

  // Sanity check - no stray .jp-Dialog left behind.
  expect(await page.locator('.jp-Dialog').count()).toBe(0);
});
