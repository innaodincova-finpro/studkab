/* R16: загрузка расписания из вуза (страница «Предстоящие события» Moodle).
   Образец синтетический: фамилии преподавателей вымышленные. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const source = html.slice(html.indexOf('var VUZ_MONTHS'), html.indexOf('function openVuzSchedule('));
const context = {};
vm.createContext(context);
vm.runInContext(source, context);

const sample = fs.readFileSync('tests/fixtures/vuz-schedule-sample.txt', 'utf8');
const TODAY = '2026-10-06';
let seq = 0;
const makeId = () => 'ev-test-' + (++seq);

test('sample of 15 classes is parsed fully with dates, times and disciplines', () => {
  const parsed = context.parseVuzSchedule(sample, TODAY);
  assert.equal(parsed.events.length, 15);
  assert.equal(parsed.unknown, 0);
  const first = parsed.events[0];
  assert.equal(first.date, '2026-10-10');
  assert.equal(first.start, '09:00');
  assert.equal(first.end, '10:30');
  assert.equal(first.kind, 'Лекция (Вебинар)');
  assert.equal(first.discipline, 'Экономика организации');
  assert.equal(first.teacher, 'Тестов А.А.');
  assert.equal(first.group, 'ЭБ-25-1');
  const last = parsed.events[14];
  assert.equal(last.date, '2026-10-19');
  assert.equal(last.start, '18:00');
  assert.equal(last.end, '19:30');
  assert.equal(last.discipline, 'Финансовый менеджмент');
  const lab = parsed.events.find(e => e.kind === 'Лабораторная работа');
  assert.equal(lab.date, '2026-10-12');
  assert.equal(lab.start, '19:40');
  assert.equal(lab.end, '21:10');
  assert.equal(lab.discipline, 'Информационные технологии');
  const dates = parsed.events.map(e => e.date);
  assert.ok(dates.every(d => d >= '2026-10-10' && d <= '2026-10-19'));
});

test('first load adds 15 class events in the existing calendar format', () => {
  const list = [];
  const r = context.mergeVuzSchedule(list, context.parseVuzSchedule(sample, TODAY), makeId);
  assert.deepEqual({ ...r }, { added: 15, updated: 0, removed: 0 });
  assert.equal(list.length, 15);
  const e = list[0];
  assert.equal(e.kind, 'cls');
  assert.equal(e.title, 'Экономика организации — лекция (вебинар)');
  assert.equal(e.date, '2026-10-10');
  assert.equal(e.time, '09:00');
  assert.equal(e.note, 'до 10:30 · Тестов А.А. · группа ЭБ-25-1');
  assert.equal(e.src, 'vuz');
  assert.equal(e.vuzKey, '2026-10-10|09:00|Экономика организации|Лекция (Вебинар)');
  assert.equal(context.vuzResultText(r, 0), 'Добавлено: 15, обновлено: 0, не распознано: 0');
});

test('loading the same text again updates by key without duplicates; manual events are untouched', () => {
  const manual = { id: 'ev-manual', kind: 'exam', title: 'Моя консультация', date: '2026-10-10', time: '09:00', wid: '', note: 'своё' };
  const list = [{ ...manual }];
  context.mergeVuzSchedule(list, context.parseVuzSchedule(sample, TODAY), makeId);
  const ids = list.filter(e => e.src === 'vuz').map(e => e.id);
  const r = context.mergeVuzSchedule(list, context.parseVuzSchedule(sample, TODAY), makeId);
  assert.deepEqual({ ...r }, { added: 0, updated: 15, removed: 0 });
  assert.equal(list.length, 16);
  assert.deepEqual(list.filter(e => e.src === 'vuz').map(e => e.id), ids);
  assert.deepEqual(list.find(e => e.id === 'ev-manual'), manual);
  assert.equal(new Set(list.map(e => e.vuzKey).filter(Boolean)).size, 15);
});

test('classes missing from a newer text are removed only inside its date range', () => {
  const list = [];
  context.mergeVuzSchedule(list, context.parseVuzSchedule(sample, TODAY), makeId);
  const outside = { id: 'ev-old', kind: 'cls', title: 'Старое — лекция', date: '2026-10-25', time: '09:00', src: 'vuz', vuzKey: '2026-10-25|09:00|Старое|Лекция' };
  list.push(outside);
  const blocks = sample.split('\n\n');
  const shorter = blocks.filter(b => !b.includes('Понедельник 12 октября, 19:40')).join('\n\n');
  const r = context.mergeVuzSchedule(list, context.parseVuzSchedule(shorter, TODAY), makeId);
  assert.deepEqual({ ...r }, { added: 0, updated: 14, removed: 1 });
  assert.ok(list.some(e => e.id === 'ev-old'));
  assert.ok(!list.some(e => e.vuzKey && e.vuzKey.startsWith('2026-10-12|19:40')));
});

test('garbage text adds nothing and yields a hint', () => {
  const list = [{ id: 'ev-manual', kind: 'other', title: 'своё', date: '2026-10-11', time: '' }];
  const parsed = context.parseVuzSchedule('Главная\nМои курсы\n\nКак дела? Тут нет расписания.\n12345', TODAY);
  assert.equal(parsed.events.length, 0);
  const r = context.mergeVuzSchedule(list, parsed, makeId);
  assert.deepEqual({ ...r }, { added: 0, updated: 0, removed: 0 });
  assert.equal(list.length, 1);
  assert.match(context.VUZ_EMPTY_HINT, /не та страница/);
});

test('a broken block is counted as unrecognized and does not stop the load', () => {
  const broken = sample + '\n\nПрактическое занятие\nПятница 32 октября, 09:00 » 10:30\nСобытие группы\nПрактическое занятие по дисциплине Право\n';
  const parsed = context.parseVuzSchedule(broken, TODAY);
  assert.equal(parsed.events.length, 15);
  assert.equal(parsed.unknown, 1);
});

test('classes copied without blank lines between blocks are still split', () => {
  const dense = sample.replace(/\n\n/g, '\n');
  const parsed = context.parseVuzSchedule(dense, TODAY);
  assert.equal(parsed.events.length, 15);
  assert.equal(parsed.unknown, 0);
});

test('year is the nearest one not earlier than 60 days before today', () => {
  assert.equal(context.vuzDateIso(10, 10, '2026-10-06'), '2026-10-10');
  assert.equal(context.vuzDateIso(10, 8, '2026-10-06'), '2026-08-10');
  assert.equal(context.vuzDateIso(1, 8, '2026-10-06'), '2027-08-01');
  assert.equal(context.vuzDateIso(15, 1, '2026-12-20'), '2027-01-15');
  assert.equal(context.vuzDateIso(10, 10, '2026-12-01'), '2026-10-10');
});

test('Moodle «Сегодня» and «Завтра» date lines are resolved relative to today', () => {
  const text = 'Лекция (Вебинар)\nСегодня, 18:00 » 19:30\nСобытие группы\nЛекция (Вебинар) по дисциплине Статистика\nСтатистика (часть лекции) Образцова Г.Д.\nЭБ-25-1\n\n' +
    'Практическое занятие\nЗавтра, 09:00 » 10:30\nСобытие группы\nПрактическое занятие по дисциплине Статистика\nСтатистика (часть практики) Образцова Г.Д.\nЭБ-25-1';
  const parsed = context.parseVuzSchedule(text, '2026-10-31');
  assert.equal(parsed.unknown, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.events.map(e => [e.date, e.start, e.end]))), [['2026-10-31', '18:00', '19:30'], ['2026-11-01', '09:00', '10:30']]);
});
