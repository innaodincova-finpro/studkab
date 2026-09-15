const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'reestr.html'), 'utf8');

test('document builder exposes one whole-document preparation process', () => {
  assert.equal((html.match(/data-prepare>/g) || []).length, 1);
  assert.doesNotMatch(html, /data-genall|data-genover|data-cloud-start|data-cloud-check/);
  assert.doesNotMatch(html, /Подготовить весь черновик|Подготовка в облаке/);
  assert.match(html, /окно можно закрыть и продолжить позже/);
});

test('unified preparation has one final Word output', () => {
  assert.doesNotMatch(html, /Скачать неполный Word|Неполный-черновик/);
  assert.match(html, /data-docx="1"[^>]*>Скачать Word</);
});

test('a lost job is searched before a new paid start', () => {
  const history = html.indexOf("action:'history'");
  const estimate = html.indexOf("action:'estimate'", history);
  const start = html.indexOf("action:'start'", estimate);
  assert.ok(history > -1 && estimate > history && start > estimate);
  assert.match(html,/Проверьте суммы и нажмите кнопку ещё раз/);
  assert.match(html, /Paid Start|Автоматический повтор заблокирован/);
});
