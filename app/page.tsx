import { redirect } from "next/navigation";

import { getAppState } from "@/lib/quest-agent/server/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const state = await getAppState();
  redirect(state.currentGoal ? "/today" : "/intake");
}
