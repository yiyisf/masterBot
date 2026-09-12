import { expect, test } from 'playwright/test';
import { expectNoAxeViolations } from './axe.mjs';

test('completes two recoverable Runs and consumes the exact Artifact Version', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cmaster.workspace.locale', 'zh-CN');
  });
  let acceptedRunResponseLost = false;
  await page.route('**/api/v1/runs', async (route) => {
    if (route.request().method() !== 'POST' || acceptedRunResponseLost) {
      await route.continue();
      return;
    }
    acceptedRunResponseLost = true;
    await route.fetch();
    await route.abort('connectionreset');
  });

  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: '继续最近的工作' })).toBeFocused();
  await page.getByRole('link', { name: '新建 Conversation' }).click();
  await page.getByRole('textbox').fill('Record the staged release fact.');
  await page.getByRole('textbox').press('Enter');

  await expect(page).toHaveURL(/\/workspace\/conversations\/[0-9a-f-]+\/runs\/[0-9a-f-]+$/u);
  const runUrl = page.url();
  await expect(page.getByText('Prior launch fact: rollout is staged.')).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(runUrl);
  await expect(page.getByText('Prior launch fact: rollout is staged.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '已完成' })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Run · 已完成' })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Conversation Messages' })
    .getByText('Record the staged release fact.', { exact: true })).toHaveCount(1);
  const firstRunId = new URL(runUrl).pathname.split('/').at(-1);
  const replay = await page.request.get(
    `/api/v1/workspace/runs/${firstRunId}/stream`,
    { headers: { 'Last-Event-ID': '1' } },
  );
  expect(replay.ok()).toBe(true);
  const replayedSequences = [...(await replay.text()).matchAll(/^id: (\d+)$/gmu)]
    .map((match) => Number.parseInt(match[1], 10));
  expect(replayedSequences.length).toBeGreaterThan(0);
  expect(replayedSequences.every((sequence) => sequence > 1)).toBe(true);
  expect(new Set(replayedSequences).size).toBe(replayedSequences.length);

  const composer = page.getByRole('textbox', { name: '继续说明要完成的工作' });
  await composer.fill('Create the exact staged rollout Artifact.');
  await composer.press('Enter');
  await expect(page).toHaveURL(/\/workspace\/conversations\/[0-9a-f-]+\/runs\/[0-9a-f-]+$/u);
  await expect(page).not.toHaveURL(runUrl);
  const secondRunUrl = page.url();
  await expect(page.locator('.tool-activity')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: '已完成' })).toBeFocused({ timeout: 20_000 });
  await expect(page.getByText('The exact staged rollout Artifact is ready.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Staged rollout plan' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Run · 已完成' })).toHaveCount(2);
  await expect(page.getByRole('link', { name: '预览确切 Version' })).toHaveAttribute(
    'href', /\/workspace\/artifacts\/[0-9a-f-]+\/versions\/[0-9a-f-]+$/u,
  );

  await page.getByRole('link', { name: '预览确切 Version' }).click();
  await expect(page.locator('#artifact-detail-title')).toBeFocused();
  await page.getByRole('button', { name: '预览确切 Version' }).click();
  await expect(page.getByRole('heading', { name: 'Rollout', exact: true })).toBeVisible();
  const downloadStarted = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载确切 Version' }).click();
  expect((await downloadStarted).suggestedFilename()).toBe('Staged rollout plan.md');

  await page.goto('/workspace');
  await expect(page.getByRole('link', { name: 'Record the staged release fact.' }).first())
    .toBeVisible();
  await expect(page.getByText('The exact staged rollout Artifact is ready.').first()).toBeVisible();
  await expect(page.getByText('已完成').first()).toBeVisible();
  await expectNoAxeViolations(page);
  expect((await page.request.get(
    '/workspace/runs/00000000-0000-4000-8000-000000000001',
  )).status()).toBe(404);
  expect(secondRunUrl).not.toBe(runUrl);
});
