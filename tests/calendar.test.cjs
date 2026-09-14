const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const source = html.slice(
  html.indexOf('function calendarDayState('),
  html.indexOf('function renderItem(')
);
const context = {
  Date,
  calSel: null,
  monthStart: iso => iso.slice(0, 8) + '01',
  parseIso: iso => new Date(iso + 'T00:00:00'),
  isoOf: value => {
    const d = new Date(value);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  },
  monthName: iso => iso.slice(0, 7),
  ruDate: iso => iso,
  esc: text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
};
vm.createContext(context);
vm.runInContext(source, context);

test('calendar state describes study progress rather than entry category', () => {
  const today = '2026-09-14';
  assert.equal(context.calendarDayState(today, [], today), '');
  assert.equal(context.calendarDayState('2026-09-20', [{ kind: 'deadline', due: '2026-09-20' }], today), 'day-ahead');
  assert.equal(context.calendarDayState('2026-09-10', [{ kind: 'task', due: '2026-09-10' }], today), 'day-missed');
  assert.equal(context.calendarDayState('2026-09-10', [{ kind: 'done', due: '2026-09-10' }], today), 'day-done');
});

test('continuous month renders previews, overflow count and accessible day label', () => {
  const markup = context.continuousMonth('2026-09-01', {
    '2026-09-14': [
      { kind: 'deadline', due: '2026-09-14', text: 'Сдать курсовую <главу>' },
      { kind: 'task', due: '2026-09-14', text: 'Проверить источники' },
      { kind: 'event', due: '2026-09-14', text: 'Консультация' }
    ]
  }, '2026-09-14');
  assert.match(markup, /Сдать курсовую &lt;главу&gt;/);
  assert.match(markup, /ещё 1/);
  assert.match(markup, /data-act="cal-day" data-d="2026-09-14"/);
  assert.match(markup, /aria-label="2026-09-14, записей: 3, запланировано"/);
  assert.match(markup, /today has-plan day-ahead/);
});
