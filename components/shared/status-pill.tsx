"use client";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { getLabel } from "@/lib/quest-agent/copy";

const toneMap: Record<string, string> = {
  active: "pill pill--active",
  planned: "pill pill--planned",
  ready: "pill pill--ready",
  suggested: "pill pill--ready",
  in_progress: "pill pill--ready",
  completed: "pill pill--done",
  blocked: "pill pill--blocked",
  overdue: "pill pill--blocked",
  open: "pill pill--blocked",
  resolved: "pill pill--done",
  high: "pill pill--blocked",
  medium: "pill pill--planned",
  low: "pill pill--active",
  draft: "pill pill--planned",
  paused: "pill pill--planned",
  abandoned: "pill pill--blocked",
  hold: "pill pill--planned",
  shrink: "pill pill--ready",
  cancel: "pill pill--blocked",
  waiting: "pill pill--planned",
  resumed: "pill pill--done",
  manual: "pill pill--planned",
  date: "pill pill--ready",
  condition: "pill pill--active",
  heuristic: "pill pill--active",
  ai: "pill pill--active",
  supabase: "pill pill--active",
  "local-file": "pill pill--planned",
  "browser-local": "pill pill--planned",
  main: "pill pill--active",
  improve: "pill pill--ready",
  admin: "pill pill--planned",
  other: "pill pill--blocked",
  direct: "pill pill--active",
  supporting: "pill pill--ready",
  unclear: "pill pill--blocked",
  build: "pill pill--active",
  avoidant: "pill pill--blocked",
  fight: "pill pill--active",
  detour: "pill pill--ready",
  retreat: "pill pill--blocked",
  capability: "pill pill--planned",
  opportunity: "pill pill--ready",
  motivation: "pill pill--active",
};

export function StatusPill({ label }: { label: string }) {
  const { state } = useQuestAgent();
  const className = toneMap[label] ?? "pill";
  const display = getLabel(state.uiPreferences.locale, label);
  return <span className={className}>{display}</span>;
}