import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectCanonicalRepoRoot } from "./theme-harness-lib.mjs";

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = detectCanonicalRepoRoot(checkoutRoot);
const require = createRequire(path.join(repoRoot, "package.json"));

const env = {
  ...process.env,
  QUEST_AGENT_BUILD_NOPROFILE: "1",
};

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: checkoutRoot,
    stdio: "inherit",
    env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

class InlineWorker {
  constructor(workerPath, options = {}) {
    this._workerPath = workerPath;
    this._options = options;
    this._moduleExports = null;
    this._onActivity = options.onActivity;
    this._onActivityAbort = options.onActivityAbort;

    for (const method of options.exposedMethods || []) {
      if (method.startsWith("_")) {
        continue;
      }

      this[method] = async (...args) => this._invoke(method, args);
    }
  }

  _loadModule() {
    if (!this._moduleExports) {
      this._moduleExports = require(this._workerPath);
    }

    return this._moduleExports;
  }

  async _invoke(method, args) {
    this._onActivity?.();
    const moduleExports = this._loadModule();
    const target = moduleExports[method];
    if (typeof target !== "function") {
      throw new Error(`Inline worker could not find exposed method \`${method}\` in ${this._workerPath}.`);
    }

    const previousIsNextWorker = process.env.IS_NEXT_WORKER;
    process.env.IS_NEXT_WORKER = "true";
    try {
      const result = await target(...args);
      this._onActivity?.();
      return result;
    } catch (error) {
      this._onActivityAbort?.();
      throw error;
    } finally {
      if (previousIsNextWorker === undefined) {
        delete process.env.IS_NEXT_WORKER;
      } else {
        process.env.IS_NEXT_WORKER = previousIsNextWorker;
      }
    }
  }

  setOnActivity(onActivity) {
    this._onActivity = onActivity;
  }

  setOnActivityAbort(onActivityAbort) {
    this._onActivityAbort = onActivityAbort;
  }

  end() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

function patchNextWorker() {
  const workerModulePath = require.resolve("next/dist/lib/worker");
  const originalWorkerModule = require(workerModulePath);
  require.cache[workerModulePath].exports = {
    ...originalWorkerModule,
    Worker: InlineWorker,
  };
}

async function runBuild() {
  runNodeScript(path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), ["--noEmit"]);
  patchNextWorker();
  const build = require("next/dist/build").default;
  await build(checkoutRoot);
}

runBuild()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
