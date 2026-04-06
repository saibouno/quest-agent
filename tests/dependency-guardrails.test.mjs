import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectInstallScriptPackages,
  evaluateDependencyGuardrails,
} from "../scripts/dependency-guardrails.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCKFILE_PATH = path.join(REPO_ROOT, "package-lock.json");
const ALLOWLIST_PATH = path.join(REPO_ROOT, "scripts", "dependency-guardrails-allowlist.json");

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function writeFixtureLockfile(testContext, mutate) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "quest-agent-dependency-guardrails-"));
  testContext.after(() => {
    rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3 });
  });

  const lockfile = readJson("package-lock.json");
  mutate(lockfile);

  const fixtureLockfilePath = path.join(fixtureRoot, "package-lock.json");
  writeFileSync(fixtureLockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`, "utf8");
  return fixtureLockfilePath;
}

test("current reviewed install-script packages match the allowlist", () => {
  const result = evaluateDependencyGuardrails({
    lockfilePath: LOCKFILE_PATH,
    allowlistPath: ALLOWLIST_PATH,
  });

  assert.deepEqual(result.findings, []);
  assert.deepEqual(
    result.installScriptPackages.map((pkg) => `${pkg.name}@${pkg.version}`),
    ["sharp@0.34.5", "supabase@2.84.10", "unrs-resolver@1.11.1"],
  );
});

test("guardrails fail when a new install-script package is added without review", (testContext) => {
  const fixtureLockfilePath = writeFixtureLockfile(testContext, (lockfile) => {
    lockfile.packages["node_modules/example-malware"] = {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/example-malware/-/example-malware-1.0.0.tgz",
      integrity: "sha512-test",
      hasInstallScript: true,
      license: "UNLICENSED",
    };
  });

  const result = evaluateDependencyGuardrails({
    lockfilePath: fixtureLockfilePath,
    allowlistPath: ALLOWLIST_PATH,
  });

  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0], /example-malware@1\.0\.0 uses install scripts but is not in/);
});

test("guardrails fail when an allowlisted install-script package changes version", (testContext) => {
  const fixtureLockfilePath = writeFixtureLockfile(testContext, (lockfile) => {
    lockfile.packages["node_modules/sharp"].version = "0.34.6";
  });

  const result = evaluateDependencyGuardrails({
    lockfilePath: fixtureLockfilePath,
    allowlistPath: ALLOWLIST_PATH,
  });

  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0], /sharp allowlist version drifted: reviewed 0\.34\.5, lockfile resolved 0\.34\.6/);
});

test("collector only returns lockfile entries marked with hasInstallScript", () => {
  const installScriptPackages = collectInstallScriptPackages(readJson("package-lock.json"));

  assert.deepEqual(
    installScriptPackages.map((pkg) => pkg.packagePath),
    ["node_modules/sharp", "node_modules/supabase", "node_modules/unrs-resolver"],
  );
});
