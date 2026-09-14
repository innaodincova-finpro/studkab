const { test, expect } = require('@playwright/test');

test('student calendar mirrors the continuous month pattern without mixing app data', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.evaluate(() => QA.switchUser('calendar-synthetic'));
  await expect.poll(() => page.evaluate(() => Oblako.canSync() && !Oblako.busy)).toBe(true);
  await page.evaluate(() => {
    D.works = [{
      id: 'study-1', topic: 'Курсовая по менеджменту', status: 'draft',
      deadline: '2026-09-20', tasks: [
        { id: 'task-open', text: 'Проверить источники', due: '2026-09-18', done: false },
        { id: 'task-done', text: 'Согласовать план', due: '2026-09-10', done: true }
      ]
    }];
    D.events = [{ id: 'event-1', wid: 'study-1', date: '2026-09-16', time: '15:00', title: 'Консультация' }];
    tab = 'cal'; calMode = 'month'; calCursor = '2026-09-01'; calSel = null; render();
  });

  await expect(page.locator('.month-card')).toHaveCount(3);
  await expect(page.locator('.month-title').first()).toContainText('сентябрь 2026');
  await expect(page.locator('[data-d="2026-09-18"]')).toContainText('Проверить источники');
  await expect(page.locator('[data-d="2026-09-20"]')).toContainText('Сдать работу: Курсовая');
  await expect(page.locator('[data-d="2026-09-10"]')).toHaveClass(/day-done/);
  await page.locator('[data-d="2026-09-18"]').click();
  await expect(page.locator('.item').filter({ hasText: 'Проверить источники' })).toBeVisible();

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
