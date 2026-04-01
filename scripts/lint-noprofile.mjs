import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCheckoutRoots } from "./theme-harness-lib.mjs";

const scriptCheckoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { checkoutRoot, toolingRoot } = resolveCheckoutRoots(scriptCheckoutRoot, {
  requiredPackages: ["eslint"],
});

const result = spawnSync(
  process.execPath,
  [path.join(toolingRoot, "eslint", "bin", "eslint.js"), ".", "--max-warnings=0"],
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
