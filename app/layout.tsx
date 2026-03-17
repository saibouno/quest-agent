import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { QuestAgentProvider } from "@/components/providers/quest-agent-provider";
import { getBackendModeLabel, getClientStorageHint } from "@/lib/quest-agent/server/runtime";
import { getAppState, isAiConfigured } from "@/lib/quest-agent/server/store";

import "./globals.css";

export const metadata: Metadata = {
  title: "Quest Agent v0.2 scaffold",
  description: "Turn ambitious goals into executable daily quests.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const state = await getAppState();
  const storageHint = getClientStorageHint();
  const backendMode = getBackendModeLabel();
  const aiMode = isAiConfigured() ? "ai" : "heuristic";

  return (
    <html lang="ja">
      <body>
        <QuestAgentProvider aiMode={aiMode} initialBackendMode={backendMode} initialState={state} storageHint={storageHint}>
          <AppShell>{children}</AppShell>
        </QuestAgentProvider>
      </body>
    </html>
  );
}