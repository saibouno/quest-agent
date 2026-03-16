import { IntakePageClient } from "@/components/pages/intake-page-client";
import { getAppState, isAiConfigured } from "@/lib/quest-agent/server/store";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  const state = await getAppState();
  return <IntakePageClient aiEnabled={isAiConfigured()} state={state} />;
}
