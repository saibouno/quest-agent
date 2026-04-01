import "server-only";

import { getDeploymentTarget } from "@/lib/quest-agent/server/runtime";

const NO_STORE_HEADER = "no-store";
const FORBIDDEN_MESSAGE = "Forbidden.";

export function jsonNoStore(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", NO_STORE_HEADER);
  return Response.json(body, {
    ...init,
    headers,
  });
}

export function jsonError(message: string, status: number) {
  return jsonNoStore({ error: message }, { status });
}

export function assertAllowedOrigin(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const deploymentTarget = getDeploymentTarget();

  if (!origin) {
    return deploymentTarget === "local" ? null : jsonError(FORBIDDEN_MESSAGE, 403);
  }

  return origin === requestOrigin ? null : jsonError(FORBIDDEN_MESSAGE, 403);
}

export function logRouteError(routeName: string, error: unknown) {
  if (error instanceof Error) {
    console.error(`[${routeName}] ${error.name}: ${error.message}`);
    return;
  }

  console.error(`[${routeName}] Non-Error value thrown.`);
}
