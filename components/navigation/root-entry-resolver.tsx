"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { getCopy } from "@/lib/quest-agent/copy";
import { resolveHomePath } from "@/lib/quest-agent/derive";

export function RootEntryResolver() {
  const router = useRouter();
  const { state, stateReady } = useQuestAgent();
  const copy = getCopy(state.uiPreferences.locale);
  const loadingLabel = state.uiPreferences.locale === "ja" ? "進行先を整えています..." : "Preparing your path...";

  useEffect(() => {
    if (!stateReady) {
      return;
    }

    router.replace(resolveHomePath(state));
  }, [router, state, stateReady]);

  return (
    <div className="center-stage">
      <SectionCard className="entry-card">
        <p className="eyebrow">{copy.shell.kicker}</p>
        <h1>{copy.shell.title}</h1>
        <p className="muted">{stateReady ? copy.metadata.description : loadingLabel}</p>
      </SectionCard>
    </div>
  );
}
