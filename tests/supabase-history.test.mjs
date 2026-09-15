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
  assert.equal(manifest.migrations.length, 14);

  for (const item of tracked) {
    const sql = await readFile(new URL(item.file, migrationsDir));
    const actual = createHash("sha256").update(sql).digest("hex");
    assert.equal(actual, item.sha256, item.file);
  }
});
