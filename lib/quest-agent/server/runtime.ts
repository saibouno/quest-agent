import "server-only";

import type { BackendModeLabel, ClientStorageHint, DeploymentTarget, ServerStorageMode } from "@/lib/quest-agent/types";

const deploymentTargets = new Set<DeploymentTarget>(["local", "main", "preview/demo", "preview/dogfood"]);

function isDeploymentTarget(value: string): value is DeploymentTarget {
  return deploymentTargets.has(value as DeploymentTarget);
}

function inferDeploymentTarget(): DeploymentTarget {
  const explicitTarget = process.env.QUEST_AGENT_DEPLOYMENT_TARGET?.trim();
  if (explicitTarget) {
    if (!isDeploymentTarget(explicitTarget)) {
      throw new Error(
        `Invalid QUEST_AGENT_DEPLOYMENT_TARGET: "${explicitTarget}". Use one of local, main, preview/demo, preview/dogfood.`,
      );
    }
    return explicitTarget;
  }

  const branchRef = process.env.VERCEL_GIT_COMMIT_REF?.trim();
  if (branchRef === "preview/demo" || branchRef === "preview/dogfood" || branchRef === "main") {
    return branchRef;
  }

  return process.env.VERCEL ? "preview/demo" : "local";
}

export function hasSupabaseConfig(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function assertRuntimeGuardrails(target: DeploymentTarget): void {
  if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is forbidden. SUPABASE_SERVICE_ROLE_KEY must remain server-only.");
  }

  if (target !== "preview/dogfood") {
    return;
  }

  if (!hasSupabaseConfig()) {
    throw new Error(
      "preview/dogfood requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. This environment must stay server-backed.",
    );
  }

  const expectedSupabaseUrl = process.env.QUEST_AGENT_EXPECTED_SUPABASE_URL?.trim();
  if (!expectedSupabaseUrl) {
    throw new Error(
      "preview/dogfood requires QUEST_AGENT_EXPECTED_SUPABASE_URL so the Supabase target stays pinned.",
    );
  }

  if (process.env.SUPABASE_URL !== expectedSupabaseUrl) {
    throw new Error(
      "preview/dogfood Supabase target changed. Update SUPABASE_URL and QUEST_AGENT_EXPECTED_SUPABASE_URL together only for an explicit dogfood migration.",
    );
  }
}

export function getDeploymentTarget(): DeploymentTarget {
  const target = inferDeploymentTarget();
  assertRuntimeGuardrails(target);
  return target;
}

export function getServerStorageMode(): ServerStorageMode {
  getDeploymentTarget();
  return hasSupabaseConfig() ? "supabase" : "local-file";
}

export function shouldUseBrowserLocalPreview(): boolean {
  return getDeploymentTarget() !== "preview/dogfood" && !hasSupabaseConfig() && Boolean(process.env.VERCEL);
}

export function getClientStorageHint(): ClientStorageHint {
  return shouldUseBrowserLocalPreview() ? "browser-local" : "server-backed";
}

export function getBackendModeLabel(): BackendModeLabel {
  return shouldUseBrowserLocalPreview() ? "browser-local" : getServerStorageMode();
}
