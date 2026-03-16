const toneMap: Record<string, string> = {
  active: "pill pill--active",
  planned: "pill pill--planned",
  ready: "pill pill--ready",
  in_progress: "pill pill--ready",
  completed: "pill pill--done",
  blocked: "pill pill--blocked",
  open: "pill pill--blocked",
  resolved: "pill pill--done",
  high: "pill pill--blocked",
  medium: "pill pill--planned",
  low: "pill pill--active",
  draft: "pill pill--planned",
  paused: "pill pill--planned",
  abandoned: "pill pill--blocked",
};

export function StatusPill({ label }: { label: string }) {
  const className = toneMap[label] ?? "pill";
  return <span className={className}>{label.replaceAll("_", " ")}</span>;
}
