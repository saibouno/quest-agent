import type { Metadata } from "next";

import { QuestAgentProvider } from "@/components/providers/quest-agent-provider";
import { getCopy } from "@/lib/quest-agent/copy";
import { getBackendModeLabel, getClientStorageHint, getDeploymentTarget } from "@/lib/quest-agent/server/runtime";
import { getAppState, isAiConfigured } from "@/lib/quest-agent/server/store";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const state = await getAppState();
  const copy = getCopy(state.uiPreferences.locale);

  return {
    title: copy.metadata.title,
    description: copy.metadata.description,
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const state = await getAppState();
  const deploymentTarget = getDeploymentTarget();
  const storageHint = getClientStorageHint();
  const backendMode = getBackendModeLabel();
  const aiMode = isAiConfigured() ? "ai" : "heuristic";

  return (
    <html lang={state.uiPreferences.locale}>
      <body>
        <QuestAgentProvider
          aiMode={aiMode}
          initialBackendMode={backendMode}
          initialDeploymentTarget={deploymentTarget}
          initialState={state}
          storageHint={storageHint}
        >
          {children}
        </QuestAgentProvider>
      </body>
    </html>
  );
}
