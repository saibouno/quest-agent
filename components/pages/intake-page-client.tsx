"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { StatStrip } from "@/components/shared/stat-strip";
import type { Goal, IntakeRefinement } from "@/lib/quest-agent/types";

function linesToString(values: string[]) {
  return values.join("\n");
}

function stringToLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildForm(goal: Goal | null) {
  return {
    id: goal?.id ?? "",
    title: goal?.title ?? "",
    description: goal?.description ?? "",
    why: goal?.why ?? "",
    deadline: goal?.deadline ?? "",
    successCriteria: linesToString(goal?.successCriteria ?? []),
    currentState: goal?.currentState ?? "",
    constraints: linesToString(goal?.constraints ?? []),
    concerns: goal?.concerns ?? "",
    todayCapacity: goal?.todayCapacity ?? "",
  };
}

export function IntakePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNewMode = searchParams.get("new") === "1";
  const { state, aiEnabled, clientStorageMode, refineIntake, saveGoal } = useQuestAgent();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refinement, setRefinement] = useState<IntakeRefinement | null>(null);
  const [form, setForm] = useState(() => buildForm(isNewMode ? null : state.focusGoal));

  const stats = useMemo(
    () => [
      { label: "Focus Goal", value: state.focusGoal ? 1 : 0, detail: state.focusGoal?.title ?? "No focus selected" },
      { label: "Active Goals", value: `${state.portfolioStats.activeGoalCount}/${state.portfolioStats.wipLimit}`, detail: "Current active count" },
      { label: "Resume Queue", value: state.portfolioStats.resumeQueueCount, detail: "Goals parked with restart notes" },
      { label: "Momentum", value: state.stats.completedThisWeek, detail: "Completed quests in the last 7 days" },
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
      try {
        const nextRefinement = await refineIntake({
          title: form.title,
          description: form.description,
          why: form.why,
          deadline: form.deadline || null,
          successCriteria: stringToLines(form.successCriteria),
          currentState: form.currentState,
          constraints: stringToLines(form.constraints),
          concerns: form.concerns,
          todayCapacity: form.todayCapacity,
        });
        setRefinement(nextRefinement);
        setForm((current) => ({
          ...current,
          title: nextRefinement.goalTitle,
          description: nextRefinement.goalSummary,
          successCriteria: linesToString(nextRefinement.successCriteria),
          constraints: linesToString(nextRefinement.constraintsToWatch),
        }));
        setMessage(nextRefinement.mode === "ai" ? "AI drafted a sharper goal." : "Heuristic mode drafted a sharper goal.");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Intake refinement failed.");
      }
    });
  }

  function handleSave() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const isEditingExisting = Boolean(form.id);
        const existingStatus = isEditingExisting ? state.goals.find((goal) => goal.id === form.id)?.status : null;
        const nextStatus = isEditingExisting
          ? existingStatus ?? "active"
          : state.portfolioStats.availableSlots > 0
            ? "active"
            : "paused";

        await saveGoal({
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
          status: nextStatus,
          refined: Boolean(refinement),
        });

        if (nextStatus === "active") {
          setMessage("Goal saved. Next, turn it into a route on Quest Map.");
          if (clientStorageMode === "server-backed") {
            router.refresh();
          }
          router.push("/map");
          return;
        }

        setMessage("Goal saved to the portfolio backlog. Activate it from Portfolio when a slot opens.");
        if (clientStorageMode === "server-backed") {
          router.refresh();
        }
        router.push("/portfolio");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Goal save failed.");
      }
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">Quest Intake</p>
          <h1>{isNewMode ? "Add a goal without losing the portfolio balance." : "Shape the goal into something you can actually move."}</h1>
          <p className="lead">
            Quest Intake now feeds the portfolio. If no active slot is open, the goal can still be captured cleanly and activated later.
          </p>
        </div>
        <div className="hero-panel__actions">
          <button className="button" onClick={handleRefine} disabled={isPending || !form.title.trim()} type="button">
            {aiEnabled ? "Refine with AI" : "Refine with heuristics"}
          </button>
          <button className="button button--secondary" onClick={handleSave} disabled={isPending || !form.title.trim()} type="button">
            Save Goal
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
              <h2>{isNewMode ? "Capture a new goal" : "Minimum input is enough"}</h2>
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
              <textarea className="textarea" rows={4} value={form.successCriteria} onChange={(event) => updateField("successCriteria", event.target.value)} placeholder="One line per item" />
            </label>
            <label className="field field--full">
              <span>Current State</span>
              <textarea className="textarea" rows={4} value={form.currentState} onChange={(event) => updateField("currentState", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>Constraints</span>
              <textarea className="textarea" rows={4} value={form.constraints} onChange={(event) => updateField("constraints", event.target.value)} placeholder="One line per item" />
            </label>
            <label className="field field--full">
              <span>Concerns / Likely Blockers</span>
              <textarea className="textarea" rows={3} value={form.concerns} onChange={(event) => updateField("concerns", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>Today&apos;s Capacity</span>
              <textarea className="textarea" rows={2} value={form.todayCapacity} onChange={(event) => updateField("todayCapacity", event.target.value)} placeholder="How much can you realistically do today?" />
            </label>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Quest Agent Draft</p>
              <h2>What the agent sees</h2>
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
            <p className="muted">Use the refine button to turn a vague goal into a cleaner working draft.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
