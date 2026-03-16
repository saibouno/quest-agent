import { TodayPageClient } from "@/components/pages/today-page-client";
import { getAppState, isAiConfigured } from "@/lib/quest-agent/server/store";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const state = await getAppState();
  return <TodayPageClient aiEnabled={isAiConfigured()} state={state} />;
}
