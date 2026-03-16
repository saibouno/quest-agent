import { MapPageClient } from "@/components/pages/map-page-client";
import { getAppState, isAiConfigured } from "@/lib/quest-agent/server/store";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const state = await getAppState();
  return <MapPageClient aiEnabled={isAiConfigured()} state={state} />;
}
