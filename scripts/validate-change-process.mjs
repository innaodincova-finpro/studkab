import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FORBIDDEN_SUBJECT = /^Add files via upload(?:\s|$)/i;

export function findProcessViolations(subjects) {
  return subjects
    .map((subject, index) => ({ subject: String(subject).trim(), index }))
    .filter(({ subject }) => FORBIDDEN_SUBJECT.test(subject))
    .map(({ subject, index }) => `commit ${index + 1}: forbidden generic subject "${subject}"`);
}

function commitSubjects(baseSha, headSha) {
  const zero = /^0{40}$/;
  const sha = /^[0-9a-f]{40}$/i;
  if (!sha.test(headSha || "")) throw new Error("CHANGE_HEAD_SHA must be a 40-character commit SHA");
  const range = sha.test(baseSha || "") && !zero.test(baseSha) ? `${baseSha}..${headSha}` : headSha;
  return execFileSync("git", ["log", "--format=%s", range], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

export function runChangeProcessCheck(env = process.env) {
  const violations = findProcessViolations(commitSubjects(env.CHANGE_BASE_SHA, env.CHANGE_HEAD_SHA));
  if (violations.length) {
    throw new Error([
      "Change-process check failed.",
      ...violations,
      "Use a meaningful commit subject connected to the requirement or defect."
    ].join("\n"));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runChangeProcessCheck();
    console.log("Change-process check passed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
