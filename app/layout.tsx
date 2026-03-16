import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { getAppState, getStorageMode, isAiConfigured } from "@/lib/quest-agent/server/store";

import "./globals.css";

export const metadata: Metadata = {
  title: "Quest Agent v0.1",
  description: "Turn ambitious goals into executable daily quests.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const state = await getAppState();
  const summary = {
    currentGoalTitle: state.currentGoal?.title ?? "No active goal yet",
    nextStepTitle: state.todaySuggestions[0]?.title ?? "Quest Intake から開始",
    openBlockers: state.stats.openBlockerCount,
    momentum: `${state.stats.completedThisWeek} quests / 7 days`,
    backendMode: getStorageMode(),
    aiMode: isAiConfigured() ? "ai" : "heuristic",
  } as const;

  return (
    <html lang="ja">
      <body>
        <AppShell summary={summary}>{children}</AppShell>
      </body>
    </html>
  );
}
