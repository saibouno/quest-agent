import type { ClientStorageHint, ClientStorageMode } from "@/lib/quest-agent/types";

export function getClientStorageMode(storageHint: ClientStorageHint): ClientStorageMode {
  if (typeof window === "undefined") {
    return "server-backed";
  }

  return storageHint === "browser-local" ? "browser-local" : "server-backed";
}