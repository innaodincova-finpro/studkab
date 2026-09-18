import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrationsDir = new URL("../supabase/migrations/", import.meta.url);

test("migration files match the production snapshot plus explicit pending changes", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", migrationsDir), "utf8"));
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  const tracked = manifest.migrations.concat(manifest.pending_migrations || []);
  const expected = tracked.map((item) => item.file).sort();
  assert.deepEqual(files, expected);
  assert.equal(manifest.migrations.length, 24);

  for (const item of tracked) {
    const sql = await readFile(new URL(item.file, migrationsDir));
    const actual = createHash("sha256").update(sql).digest("hex");
    assert.equal(actual, item.sha256, item.file);
  }
});

test('C-051, замечание 6: база собирается только из общего перечня изменений', async () => {
  const {existsSync} = await import('node:fs');
  assert.equal(existsSync(new URL('../supabase/reconciliation/studkab-production-drift.sql', import.meta.url)), false,
    'объекты базы описаны вне общего перечня');
  const workflow = await readFile(new URL('../.github/workflows/safety.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /production-drift/);
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql'));
  const all = (await Promise.all(files.map((f) => readFile(new URL(f, migrationsDir), 'utf8')))).join('\n');
  for (const name of ['studkab_gen_pricing', 'studkab_gen_recoveries', 'studkab_gen_maintenance', 'studkab_gen_settle_costs',
    'studkab_gen_writeoff_unknown', 'studkab_gen_recover_unknown', 'studkab_gen_resume_budget'])
    assert.match(all, new RegExp('public\\.' + name + '\\b'), name);
});
