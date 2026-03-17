import "server-only";

import type { BackendModeLabel, ClientStorageHint, ServerStorageMode } from "@/lib/quest-agent/types";

export function hasSupabaseConfig(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getServerStorageMode(): ServerStorageMode {
  return hasSupabaseConfig() ? "supabase" : "local-file";
}

export function shouldUseBrowserLocalPreview(): boolean {
  return !hasSupabaseConfig() && Boolean(process.env.VERCEL);
}

export function getClientStorageHint(): ClientStorageHint {
  return shouldUseBrowserLocalPreview() ? "browser-local" : "server-backed";
}

export function getBackendModeLabel(): BackendModeLabel {
  return shouldUseBrowserLocalPreview() ? "browser-local" : getServerStorageMode();
}