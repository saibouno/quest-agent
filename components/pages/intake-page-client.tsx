"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { SectionCard } from "@/components/shared/section-card";
import { StatStrip } from "@/components/shared/stat-strip";
import type { AppState, IntakeRefinement } from "@/lib/quest-agent/types";

function linesToString(values: string[]) {
  return values.join("\n");
}

function stringToLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function IntakePageClient({ state, aiEnabled }: { state: AppState; aiEnabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [refinement, setRefinement] = useState<IntakeRefinement | null>(null);
  const [form, setForm] = useState({
    id: state.currentGoal?.id ?? "",
    title: state.currentGoal?.title ?? "",
    description: state.currentGoal?.description ?? "",
    why: state.currentGoal?.why ?? "",
    deadline: state.currentGoal?.deadline ?? "",
    successCriteria: linesToString(state.currentGoal?.successCriteria ?? []),
    currentState: state.currentGoal?.currentState ?? "",
    constraints: linesToString(state.currentGoal?.constraints ?? []),
    concerns: state.currentGoal?.concerns ?? "",
    todayCapacity: state.currentGoal?.todayCapacity ?? "",
  });

  const stats = useMemo(
    () => [
      { label: "Current Goal", value: state.currentGoal ? 1 : 0, detail: state.currentGoal ? "active route exists" : "no active route yet" },
      { label: "Milestones", value: state.currentMilestones.length, detail: "goal を支える段階数" },
      { label: "Open Blockers", value: state.stats.openBlockerCount, detail: "詰まりを見える化" },
      { label: "Momentum", value: state.stats.completedThisWeek, detail: "過去7日で完了した quest" },
    ],
    [state],
  );

  function updateField(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleRefine() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const response = await fetch("/api/ai/intake-refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          why: form.why,
          deadline: form.deadline || null,
          successCriteria: stringToLines(form.successCriteria),
          currentState: form.currentState,
          constraints: stringToLines(form.constraints),
          concerns: form.concerns,
          todayCapacity: form.todayCapacity,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Intake refinement failed.");
        return;
      }
      const nextRefinement = payload.data as IntakeRefinement;
      setRefinement(nextRefinement);
      setForm((current) => ({
        ...current,
        title: nextRefinement.goalTitle,
        description: nextRefinement.goalSummary,
        successCriteria: linesToString(nextRefinement.successCriteria),
        constraints: linesToString(nextRefinement.constraintsToWatch),
      }));
      setMessage(nextRefinement.mode === "ai" ? "AI が goal draft を整えました。" : "Heuristic mode で goal draft を整えました。");
    });
  }

  function handleSave() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || undefined,
          title: form.title,
          description: form.description,
          why: form.why,
          deadline: form.deadline || null,
          successCriteria: stringToLines(form.successCriteria),
          currentState: form.currentState,
          constraints: stringToLines(form.constraints),
          concerns: form.concerns,
          todayCapacity: form.todayCapacity,
          status: "active",
          refined: Boolean(refinement),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Goal save failed.");
        return;
      }
      setMessage("Goal を保存しました。次は Quest Map で route を作ります。");
      router.refresh();
      router.push("/map");
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">Quest Intake</p>
          <h1>目標を、進められる形に整える。</h1>
          <p className="lead">
            ここでは目標の気合いではなく、達成条件、現在地、制約、今日の余力を整理します。Quest Agent が route の叩き台を引き受けます。
          </p>
        </div>
        <div className="hero-panel__actions">
          <button className="button" onClick={handleRefine} disabled={isPending || !form.title.trim()} type="button">
            {aiEnabled ? "AI で整える" : "Heuristic で整える"}
          </button>
          <button className="button button--secondary" onClick={handleSave} disabled={isPending || !form.title.trim()} type="button">
            Goal を保存
          </button>
        </div>
      </section>

      <StatStrip items={stats} />

      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <div className="two-column">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Goal Form</p>
              <h2>最小入力だけで十分です</h2>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Goal Title</span>
              <input className="input" value={form.title} onChange={(event) => updateField("title", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>Goal Summary</span>
              <textarea className="textarea" rows={4} value={form.description} onChange={(event) => updateField("description", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>Why</span>
              <textarea className="textarea" rows={3} value={form.why} onChange={(event) => updateField("why", event.target.value)} />
            </label>
            <label className="field">
              <span>Deadline</span>
              <input className="input" type="date" value={form.deadline} onChange={(event) => updateField("deadline", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>Success Criteria</span>
              <textarea className="textarea" rows={4} value={form.successCriteria} onChange={(event) => updateField("successCriteria", event.target.value)} placeholder="1行に1つずつ" />
            </label>
            <label className="field field--full">
              <span>Current State</span>
              <textarea className="textarea" rows={4} value={form.currentState} onChange={(event) => updateField("currentState", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>Constraints</span>
              <textarea className="textarea" rows={4} value={form.constraints} onChange={(event) => updateField("constraints", event.target.value)} placeholder="1行に1つずつ" />
            </label>
            <label className="field field--full">
              <span>Concerns / Blockers</span>
              <textarea className="textarea" rows={3} value={form.concerns} onChange={(event) => updateField("concerns", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>Today&apos;s Capacity</span>
              <textarea className="textarea" rows={2} value={form.todayCapacity} onChange={(event) => updateField("todayCapacity", event.target.value)} placeholder="今日はどれくらい進められそうか" />
            </label>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Quest Agent Draft</p>
              <h2>叩き台</h2>
            </div>
          </div>

          {refinement ? (
            <div className="draft-stack">
              <div>
                <p className="eyebrow">Mode</p>
                <strong>{refinement.mode}</strong>
              </div>
              <div>
                <p className="eyebrow">Goal Summary</p>
                <p>{refinement.goalSummary}</p>
              </div>
              <div>
                <p className="eyebrow">Success Criteria</p>
                <ul className="bullet-list">
                  {refinement.successCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="eyebrow">Open Questions</p>
                <ul className="bullet-list">
                  {refinement.openQuestions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="eyebrow">First Route Note</p>
                <p>{refinement.firstRouteNote}</p>
              </div>
            </div>
          ) : (
            <p className="muted">
              Goal を入力して「{aiEnabled ? "AI で整える" : "Heuristic で整える"}」を押すと、success criteria と open questions を含む goal draft がここに出ます。
            </p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

