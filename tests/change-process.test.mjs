import test from "node:test";
import assert from "node:assert/strict";
import { findProcessViolations } from "../scripts/validate-change-process.mjs";

test("accepts meaningful commit subjects", () => {
  assert.deepEqual(findProcessViolations([
    "C-025: require Safety checks for main",
    "Fix cloud result selector"
  ]), []);
});

test("rejects GitHub web-upload default subject", () => {
  assert.deepEqual(findProcessViolations(["Add files via upload"]), [
    'commit 1: forbidden generic subject "Add files via upload"'
  ]);
});

test("rejects case and suffix variants", () => {
  assert.equal(findProcessViolations(["add files via upload batch 2"]).length, 1);
});
