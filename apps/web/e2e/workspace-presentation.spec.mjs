import { expect, test } from 'playwright/test';
import { expectNoAxeViolations } from './axe.mjs';

const ids = {
  conversation: '10000000-0000-4000-8000-000000000001',
  run: '10000000-0000-4000-8000-000000000002',
  message: '10000000-0000-4000-8000-000000000003',
  interrupt: '10000000-0000-4000-8000-000000000004',
  artifact: '10000000-0000-4000-8000-000000000005',
  version: '10000000-0000-4000-8000-000000000006',
};

async function mockWorkspace(page) {
  let confirmationResolved = false;
  let uncertaintyResolved = false;
  await page.route('**/api/v1/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    const method = route.request().method();
    if (method === 'POST' && path.includes('/tool-confirmations/')) {
      confirmationResolved = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (method === 'POST' && path.includes('/interrupts/')) {
      uncertaintyResolved = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (method === 'POST' && path.endsWith('/commands/cancel')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (path.endsWith('/content')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/markdown; charset=utf-8',
        ...(requestUrl.searchParams.get('disposition') === 'attachment'
          ? { headers: { 'Content-Disposition': 'attachment; filename="mobile-report.md"' } }
          : {}),
        body: '# Exact mobile preview',
      });
      return;
    }
    let body;
    if (method === 'POST' && path === '/api/v1/conversations') {
      body = {
        id: ids.conversation, organizationId: '20000000-0000-4000-8000-000000000001',
        createdByPrincipalId: '20000000-0000-4000-8000-000000000002',
        lastMessageSequence: 0, createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
    } else if (method === 'POST'
      && path === `/api/v1/conversations/${ids.conversation}/messages`) {
      body = {
        id: ids.message, organizationId: '20000000-0000-4000-8000-000000000001',
        conversationId: ids.conversation, sequence: 1, author: 'employee',
        parts: [{ type: 'text', text: 'Keyboard message' }],
        createdAt: '2026-01-01T00:00:01.000Z',
      };
    } else if (method === 'POST' && path === '/api/v1/runs') {
      body = { runId: ids.run, eventsUrl: `/api/v1/runs/${ids.run}/events` };
    } else if (path === '/api/v1/workspace/summary') {
      body = { activeRunCount: 0, pendingActionCount: 1 };
    } else if (path === '/api/v1/workspace/conversations') {
      body = { items: [], nextCursor: null };
    } else if (path === `/api/v1/conversations/${ids.conversation}`) {
      body = {
        id: ids.conversation, organizationId: '20000000-0000-4000-8000-000000000001',
        createdByPrincipalId: '20000000-0000-4000-8000-000000000002',
        title: 'Mobile work', createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
    } else if (path === `/api/v1/conversations/${ids.conversation}/messages`) {
      body = { items: [], nextSequence: 0 };
    } else if (path === `/api/v1/conversations/${ids.conversation}/runs`) {
      body = { items: [], nextCursor: null };
    } else if (path === `/api/v1/workspace/runs/${ids.run}/projection`) {
      body = {
        schemaVersion: 1, runId: ids.run, conversationId: ids.conversation,
        triggerMessageId: ids.message, status: 'waiting', cancellable: true,
        lastSequence: 4, timeline: [], hasEarlierTimeline: false,
        activeInterrupt: confirmationResolved ? null : {
          id: ids.interrupt, kind: 'tool_confirmation', title: 'Send approved report',
          details: { destination: 'Internal archive' }, allowedResponses: ['confirm', 'reject'],
        },
        technical: { correlationId: ids.run },
      };
    } else if (path === '/api/v1/workspace/interrupts') {
      body = { items: uncertaintyResolved ? [] : [{
        kind: 'uncertain_tool_outcome_review', conversationId: ids.conversation,
        triggerMessageId: ids.message, runId: ids.run, interruptId: ids.interrupt,
        createdAt: '2026-01-01T00:00:00.000Z',
        allowedResponses: ['continue_with_uncertainty'],
        subject: { title: 'Delivery outcome unknown', details: {} },
      }], nextCursor: null };
    } else if (path === '/api/v1/artifacts') {
      body = { items: [], nextCursor: null };
    } else if (path === `/api/v1/artifacts/${ids.artifact}/versions`) {
      body = {
        artifact: {
          id: ids.artifact, title: 'Mobile report', kind: 'text', currentVersionNumber: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        items: [{
          id: ids.version, artifactId: ids.artifact, versionNumber: 1,
          mediaType: 'text/markdown; charset=utf-8', sizeBytes: 22,
          createdAt: '2026-01-01T00:00:00.000Z',
        }], beforeVersionNumber: null,
      };
    } else if (path === `/api/v1/artifacts/${ids.artifact}/versions/${ids.version}`) {
      body = {
        id: ids.version, artifactId: ids.artifact, versionNumber: 1,
        mediaType: 'text/markdown; charset=utf-8', sizeBytes: 22,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
    } else {
      body = { type: 'about:blank', title: 'Not found', status: 404 };
    }
    await route.fulfill({
      status: typeof body.status === 'number' ? body.status : 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockWorkspace(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('cmaster.workspace.locale')) {
      localStorage.setItem('cmaster.workspace.locale', 'zh-CN');
    }
  });
});

test('desktop and tablet expose accessible bilingual theme and navigation presentation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: '继续最近的工作' })).toBeFocused();
  await expect(page.getByLabel('工作区偏好')).toBeVisible();
  await expect(page.getByRole('region', { name: '工作区活动' })).toBeVisible();
  await page.getByLabel('语言').selectOption('en-US');
  await expect(page.getByRole('heading', { name: 'Continue recent work' })).toBeVisible();
  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoAxeViolations(page);
  await page.getByLabel('Theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expectNoAxeViolations(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.getByLabel('Theme').selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const reducedMotion = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.animationDuration = '2s';
    probe.style.transitionDuration = '2s';
    probe.style.scrollBehavior = 'smooth';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
      scrollBehavior: style.scrollBehavior,
    };
  });
  expect(reducedMotion).toEqual({
    animationDuration: '1e-05s', transitionDuration: '1e-05s', scrollBehavior: 'auto',
  });

  await page.goto(`/workspace/conversations/${ids.conversation}/runs/${ids.run}`);
  const conversationPanel = page.getByRole('region', { name: 'Conversation Thread' });
  const runPanel = page.getByRole('complementary', { name: 'Run Detail' });
  await expect(conversationPanel).toBeVisible();
  await expect(runPanel).toBeVisible();
  const conversationBox = await conversationPanel.boundingBox();
  const runBox = await runPanel.boundingBox();
  expect(runBox?.x).toBeGreaterThan((conversationBox?.x ?? 0) + (conversationBox?.width ?? 0));

  await page.setViewportSize({ width: 820, height: 900 });
  await expect(runPanel).toHaveCSS('position', 'fixed');
  const toggle = page.getByRole('button', { name: 'Open navigation' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  const closeToggle = page.getByRole('button', { name: 'Close navigation' });
  await expect(closeToggle).toHaveAttribute('aria-expanded', 'true');
  await closeToggle.press('Escape');
  const reopenedToggle = page.getByRole('button', { name: 'Open navigation' });
  await expect(reopenedToggle).toBeFocused();
  await expect(reopenedToggle).toHaveAttribute('aria-expanded', 'false');
});

test('mobile uses a bottom navigation and preserves locale, theme, and keyboard Composer flow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.goto('/workspace');
  const navigation = page.getByRole('navigation', { name: '员工工作区' });
  const box = await navigation.boundingBox();
  expect(box).not.toBeNull();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual(viewportHeight - 1);

  await page.getByLabel('主题').selectOption('dark');
  await page.getByLabel('语言').selectOption('en-US');
  await page.goto(`/workspace/conversations/${ids.conversation}`);
  await expect(page.getByRole('heading', { name: 'Mobile work' })).toBeFocused();
  await page.goto('/workspace');
  await page.getByRole('link', { name: 'New conversation' }).click();
  const composer = page.getByRole('textbox');
  await composer.focus();
  await composer.fill('Keyboard message');
  await expect(composer).toBeFocused();
  await composer.press('Enter');
  await expect(page).toHaveURL(
    new RegExp(`/workspace/conversations/${ids.conversation}/runs/${ids.run}$`, 'u'),
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');

  await expect(page.getByRole('region', { name: 'Conversation Thread' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Waiting', exact: true })).toBeFocused();
  await expect(page.getByText('Send approved report')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm once' }).click();
  await expect(page.getByText('Send approved report')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Waiting', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel run' }).click();
  await expect(page.getByRole('dialog', { name: 'Cancel this run?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Cancel run' })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel run' }).click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByText('The run was cancelled. Completed Tool effects were not undone.'))
    .toBeFocused();
  await expectNoAxeViolations(page);

  await page.goto('/workspace/pending');
  await expect(page.getByRole('heading', { name: 'Work waiting for you' })).toBeFocused();
  await expect(page.getByText('Delivery outcome unknown')).toBeVisible();
  await expect(page.getByText(/does not retry.*or relabel/i)).toBeVisible();
  await page.getByRole('button', { name: 'Continue with uncertainty' }).click();
  await expect(page.getByText('This item was already handled. Current server state is shown.'))
    .toBeFocused();
  await expectNoAxeViolations(page);

  await page.goto(`/workspace/artifacts/${ids.artifact}/versions/${ids.version}`);
  await page.getByRole('button', { name: 'Preview exact Version' }).click();
  await expect(page.getByRole('heading', { name: 'Exact mobile preview' })).toBeVisible();
  const downloadLink = page.getByRole('link', { name: 'Download exact Version' });
  await expect(downloadLink)
    .toHaveAttribute('href', new RegExp(`${ids.artifact}/versions/${ids.version}/content\\?disposition=attachment$`, 'u'));
  const downloadStarted = page.waitForEvent('download');
  await downloadLink.click();
  const download = await downloadStarted;
  expect(download.suggestedFilename()).toBe('mobile-report.md');
  await expectNoAxeViolations(page);
});
