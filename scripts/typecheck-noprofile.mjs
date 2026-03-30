import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectCanonicalRepoRoot } from "./theme-harness-lib.mjs";

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = detectCanonicalRepoRoot(checkoutRoot);

const result = spawnSync(
  process.execPath,
  [path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "--noEmit"],
  {
    cwd: checkoutRoot,
    stdio: "inherit",
    env: process.env,
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
