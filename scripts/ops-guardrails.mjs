import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const findings = [];
const scanRoots = ["app", "components", "lib"];
const allowedPublicGuardFiles = new Set([
  path.join(root, "lib/quest-agent/server/runtime.ts"),
]);
const allowedServiceRoleFiles = new Set([
  path.join(root, "lib/quest-agent/server/runtime.ts"),
  path.join(root, "lib/quest-agent/server/store.ts"),
]);

function walk(dir) {
  const absDir = path.join(root, dir);
  const entries = readdirSync(absDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path.relative(root, absPath)));
      continue;
    }

    if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(absPath);
    }
  }

  return files;
}

function addFinding(detail) {
  findings.push(detail);
}

function scanSourceFile(file) {
  const text = readFileSync(file, "utf8");
  const relativePath = path.relative(root, file);

  if (text.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY") && !allowedPublicGuardFiles.has(file)) {
    addFinding(`${relativePath}: NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is forbidden.`);
  }

  if (text.includes("SUPABASE_SERVICE_ROLE_KEY") && !allowedServiceRoleFiles.has(file)) {
    addFinding(`${relativePath}: SUPABASE_SERVICE_ROLE_KEY must stay in server runtime/store only.`);
  }
}

function checkEnvContract() {
  if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
    addFinding("Environment: NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY must not be set.");
  }

  if (process.env.QUEST_AGENT_DEPLOYMENT_TARGET !== "preview/dogfood") {
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    addFinding("Environment: preview/dogfood requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  if (!process.env.SUPABASE_DB_URL) {
    addFinding("Environment: preview/dogfood requires SUPABASE_DB_URL for backup and restore operations.");
  }

  if (!process.env.QUEST_AGENT_EXPECTED_SUPABASE_URL) {
    addFinding("Environment: preview/dogfood requires QUEST_AGENT_EXPECTED_SUPABASE_URL.");
  } else if (process.env.SUPABASE_URL !== process.env.QUEST_AGENT_EXPECTED_SUPABASE_URL) {
    addFinding("Environment: SUPABASE_URL must match QUEST_AGENT_EXPECTED_SUPABASE_URL in preview/dogfood.");
  }
}

scanRoots.flatMap((dir) => walk(dir)).forEach(scanSourceFile);
checkEnvContract();

if (findings.length) {
  console.error("ops guardrails failed:\n");
  findings.forEach((finding) => {
    console.error(`- ${finding}`);
  });
  process.exit(1);
}

console.log("ops guardrails passed");
