/* R16: «Расписание из вуза» в календаре кабинета студента. Образец синтетический. */
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const sample = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'vuz-schedule-sample.txt'), 'utf8');

async function openVuz(page) {
  await page.locator('#fab').click();
  await page.locator('[data-pick="vuz"]').click();
  await expect(page.getByRole('heading', { name: 'Расписание из вуза' })).toBeVisible();
}

test('student loads the university schedule, reloads it without duplicates and keeps own events', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-06T10:00:00'));
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.evaluate(() => QA.switchUser('vuz-schedule-synthetic'));
  await expect.poll(() => page.evaluate(() => Oblako.canSync() && !Oblako.busy)).toBe(true);
  await page.evaluate(() => {
    D.works = [];
    D.events = [{ id: 'ev-manual', kind: 'exam', title: 'Моя консультация', date: '2026-10-10', time: '09:00', wid: '', note: 'своё' }];
    save(); tab = 'cal'; calMode = 'month'; calCursor = '2026-10-01'; calSel = null; render();
  });

  await page.locator('#fab').click();
  const item = page.locator('[data-pick="vuz"]');
  await expect(item).toContainText('Расписание из вуза');
  await expect(item).toContainText('Скопируйте страницу „Предстоящие события“ из кабинета вуза и вставьте сюда');
  await item.click();
  await expect(page.locator('.vuz-steps li')).toHaveCount(3);
  await expect(page.locator('.vuz-steps')).toContainText('Ctrl+A');

  await page.locator('#vuzText').fill(sample);
  await page.getByRole('button', { name: 'Загрузить' }).click();
  await expect(page.locator('#vuzResult')).toHaveText('Добавлено: 15, обновлено: 0, не распознано: 0');

  const first = await page.evaluate(() => D.events.filter(e => e.src === 'vuz').map(e => ({ id: e.id, title: e.title, date: e.date, time: e.time, note: e.note })));
  expect(first).toHaveLength(15);
  expect(first[0]).toMatchObject({ title: 'Экономика организации — лекция (вебинар)', date: '2026-10-10', time: '09:00', note: 'до 10:30 · Тестов А.А. · группа ЭБ-25-1' });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem(KEY)).events.filter(e => e.src === 'vuz').length);
  expect(stored).toBe(15);

  await page.getByRole('button', { name: 'Загрузить' }).click();
  await expect(page.locator('#vuzResult')).toHaveText('Добавлено: 0, обновлено: 15, не распознано: 0');
  const again = await page.evaluate(() => D.events.filter(e => e.src === 'vuz').map(e => e.id));
  expect(again).toEqual(first.map(e => e.id));
  const manual = await page.evaluate(() => D.events.find(e => e.id === 'ev-manual'));
  expect(manual).toEqual({ id: 'ev-manual', kind: 'exam', title: 'Моя консультация', date: '2026-10-10', time: '09:00', wid: '', note: 'своё' });

  await page.locator('#vuzText').fill('Главная\nМои курсы\n\nЗдесь нет расписания');
  await page.getByRole('button', { name: 'Загрузить' }).click();
  await expect(page.locator('#vuzResult')).toContainText('Добавлено: 0');
  await expect(page.locator('#vuzResult')).toContainText('не та страница');
  expect(await page.evaluate(() => D.events.length)).toBe(16);

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#vuzText')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Загрузить' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/vuz-schedule-${viewport.width}.png` });
  }

  await page.locator('.sheet .rowbtns [data-x]').click();
  await page.locator('[data-d="2026-10-12"]').click();
  await expect(page.locator('.item').filter({ hasText: 'Информационные технологии — лабораторная работа' })).toBeVisible();
});

test('month view: tapping a day shows its list right away (the list is below three months)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-06T10:00:00'));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.evaluate(() => {
    D.works = [];
    D.events = [{ id: 'ev-p', kind: 'cls', title: 'История России — практическое занятие', date: '2026-10-10', time: '09:00', wid: '', note: 'до 10:20', src: 'vuz' }];
    save(); tab = 'cal'; calMode = 'month'; calCursor = '2026-10-01'; calSel = null; render();
  });
  await expect(page.locator('#cal-day-list')).toHaveCount(0);
  await page.locator('[data-act="cal-day"][data-d="2026-10-10"]').first().click();
  await expect(page.locator('#cal-day-list')).toBeInViewport();
  await expect(page.locator('[data-act="edit-event"][data-id="ev-p"]')).toBeInViewport();
});
