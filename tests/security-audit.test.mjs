import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('browser pages use the pinned repository copy of Supabase', () => {
  for (const file of ['index.html', 'reestr.html', 'activate.html']) {
    const html = read(file);
    assert.match(html, /<script src="vendor\/supabase-2\.57\.4\.js"><\/script>/, file);
    assert.doesNotMatch(html, /cdn\.jsdelivr\.net|@supabase\/supabase-js@2/, file);
    assert.match(html, /Content-Security-Policy/, file);
    assert.match(html, /script-src 'self' 'unsafe-inline'/, file);
  }
  const vendored = fs.readFileSync(new URL('../vendor/supabase-2.57.4.js', import.meta.url));
  assert.equal(
    crypto.createHash('sha256').update(vendored).digest('hex'),
    '7e94b62086deecef8c0ba3b38f514e2a1944ff6c81d92fb3ff967828c406c38f',
    'vendored Supabase bundle must match the reviewed 2.57.4 artifact',
  );
});

test('GitHub Actions are pinned to immutable commits', () => {
  for (const file of ['.github/workflows/safety.yml', '.github/workflows/deploy-ai-proxy.yml']) {
    const workflow = read(file);
    assert.doesNotMatch(workflow, /uses:\s+actions\/(?:checkout|setup-node|upload-artifact)@v\d/);
  }
});

test('browser acceptance replaces the vendored SDK with its isolated cloud double', () => {
  const preview = read('vite.config.mjs');
  assert.match(preview, /vendor\/supabase-2\.57\.4\.js/);
  assert.match(preview, /tests\/qa-cloud\.js/);
});

test('production proxy deploys automatically only from main', () => {
  const workflow = read('.github/workflows/deploy-ai-proxy.yml');
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.doesNotMatch(workflow, /fix\/generation-connection-diagnostics/);
});

test('HTML escaping includes apostrophes', () => {
  for (const file of ['index.html', 'reestr.html']) {
    const html = read(file);
    assert.match(html, /replace\(\/\[&<>"'\]\/g/);
    assert.match(html, /"'":"&#39;"/);
  }
});
