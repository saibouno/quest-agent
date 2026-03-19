"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { StatStrip } from "@/components/shared/stat-strip";
import { StatusPill } from "@/components/shared/status-pill";
import type { Blocker, TodayPlan } from "@/lib/quest-agent/types";

export function TodayPageClient() {
  const router = useRouter();
  const { state, aiEnabled, clientStorageMode, planToday, updateQuestStatus, createBlocker } = useQuestAgent();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [todayPlan, setTodayPlan] = useState<TodayPlan | null>(null);
  const [latestBlocker, setLatestBlocker] = useState<Blocker | null>(state.currentBlockers[0] ?? null);
  const [blockerForm, setBlockerForm] = useState({
    title: "",
    description: "",
    blockerType: "unknown",
    severity: "medium",
    relatedQuestId: state.currentQuests[0]?.id ?? "",
  });

  const stats = useMemo(
    () => [
      {
        label: "Ready Quests",
        value: state.currentQuests.filter((quest) => quest.status === "ready" || quest.status === "in_progress").length,
        detail: "Quests that are easiest to move today",
      },
      { label: "Open Blockers", value: state.stats.openBlockerCount, detail: "Stalls worth naming early" },
      { label: "Completed This Week", value: state.stats.completedThisWeek, detail: "Small wins already recorded" },
      { label: "Milestones", value: state.stats.milestoneCount, detail: "Stages supporting the current goal" },
    ],
    [state],
  );

  if (!state.currentGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">Today&apos;s Quests</p>
        <h1>Create a goal first.</h1>
        <Link className="button" href="/intake">
          Go to Quest Intake
        </Link>
      </SectionCard>
    );
  }

  if (!state.currentQuests.length) {
    return (
      <SectionCard>
        <p className="eyebrow">Today&apos;s Quests</p>
        <h1>You need a route before the agent can suggest today&apos;s quests.</h1>
        <p className="muted">Build the Quest Map first so today can shrink to 1 to 3 concrete steps.</p>
        <Link className="button" href="/map">
          Go to Quest Map
        </Link>
      </SectionCard>
    );
  }

  const plan = todayPlan ?? {
    theme: "Use the lowest-friction quests already visible in the route.",
    quests: state.todaySuggestions,
    notes: [
      state.currentGoal.todayCapacity ? `Today's capacity: ${state.currentGoal.todayCapacity}` : "Start with something that fits in 25 to 45 minutes.",
    ],
    mode: "heuristic" as const,
  };

  function setStatus(nextQuestId: string, status: "ready" | "in_progress" | "completed") {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await updateQuestStatus(nextQuestId, status);
        setMessage(status === "completed" ? "Quest marked as completed." : "Quest status updated.");
        if (clientStorageMode === "server-backed") {
          router.refresh();
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Quest update failed.");
      }
    });
  }

  function handleReplan() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const nextPlan = await planToday({ goalId: state.currentGoal?.id });
        setTodayPlan(nextPlan);
        setMessage(nextPlan.mode === "ai" ? "AI refreshed today's route." : "Heuristic mode refreshed today's route.");
        if (clientStorageMode === "server-backed") {
          router.refresh();
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Today's route generation failed.");
      }
    });
  }

  function handleCreateBlocker() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const result = await createBlocker({
          goalId: state.currentGoal!.id,
          relatedQuestId: blockerForm.relatedQuestId || null,
          title: blockerForm.title,
          description: blockerForm.description,
          blockerType: blockerForm.blockerType as Blocker["blockerType"],
          severity: blockerForm.severity as Blocker["severity"],
          status: "open",
        });
        setLatestBlocker(result.blocker);
        setBlockerForm({
          title: "",
          description: "",
          blockerType: "unknown",
          severity: "medium",
          relatedQuestId: state.currentQuests[0]?.id ?? "",
        });
        setMessage("Blocker recorded. The reroute suggestion is ready.");
        if (clientStorageMode === "server-backed") {
          router.refresh();
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Blocker save failed.");
      }
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">Today&apos;s Quests</p>
          <h1>Shrink the route into 1 to 3 steps for today.</h1>
          <p className="lead">Favor restartability and real forward motion over abstract planning.</p>
        </div>
        <div className="hero-panel__actions">
          <button className="button" onClick={handleReplan} disabled={isPending} type="button">
            {aiEnabled ? "Replan with AI" : "Replan heuristically"}
          </button>
        </div>
      </section>

      <StatStrip items={stats} />
      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <div className="two-column two-column--wide">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Today Plan</p>
              <h2>{plan.theme}</h2>
            </div>
            <StatusPill label={plan.mode} />
          </div>

          <div className="stack-lg">
            {plan.quests.map((quest) => (
              <div className="quest-plan-card" key={`${quest.questId ?? quest.title}`}>
                <div className="quest-plan-card__header">
                  <div>
                    <h3>{quest.title}</h3>
                    <p className="muted">{quest.reason}</p>
                  </div>
                  <div className="pill-row">
                    <StatusPill label={quest.status} />
                    <span className="pill">{quest.focusMinutes} min</span>
                  </div>
                </div>
                <p>{quest.successHint}</p>
              </div>
            ))}
            <ul className="bullet-list muted-list">
              {plan.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Quest Control</p>
              <h2>Start, complete, or reset a quest</h2>
            </div>
          </div>

          <div className="quest-list">
            {state.currentQuests.map((quest) => (
              <div className="quest-row quest-row--stack" key={quest.id}>
                <div>
                  <div className="pill-row">
                    <StatusPill label={quest.priority} />
                    <StatusPill label={quest.status} />
                  </div>
                  <h3>{quest.title}</h3>
                  <p className="muted">{quest.description || "No description yet."}</p>
                </div>
                <div className="button-row">
                  <button className="button button--ghost" disabled={isPending} onClick={() => setStatus(quest.id, "ready")} type="button">
                    ready
                  </button>
                  <button className="button button--ghost" disabled={isPending} onClick={() => setStatus(quest.id, "in_progress")} type="button">
                    start
                  </button>
                  <button className="button button--secondary" disabled={isPending} onClick={() => setStatus(quest.id, "completed")} type="button">
                    complete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="two-column">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Blocker Intake</p>
              <h2>Name the stall without blaming yourself</h2>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Title</span>
              <input className="input" value={blockerForm.title} onChange={(event) => setBlockerForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label className="field">
              <span>Related Quest</span>
              <select className="input" value={blockerForm.relatedQuestId} onChange={(event) => setBlockerForm((current) => ({ ...current, relatedQuestId: event.target.value }))}>
                {state.currentQuests.map((quest) => (
                  <option key={quest.id} value={quest.id}>
                    {quest.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--full">
              <span>Description</span>
              <textarea className="textarea" rows={3} value={blockerForm.description} onChange={(event) => setBlockerForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <label className="field">
              <span>Type</span>
              <select className="input" value={blockerForm.blockerType} onChange={(event) => setBlockerForm((current) => ({ ...current, blockerType: event.target.value }))}>
                <option value="clarity">clarity</option>
                <option value="time">time</option>
                <option value="decision">decision</option>
                <option value="dependency">dependency</option>
                <option value="energy">energy</option>
                <option value="unknown">unknown</option>
              </select>
            </label>
            <label className="field">
              <span>Severity</span>
              <select className="input" value={blockerForm.severity} onChange={(event) => setBlockerForm((current) => ({ ...current, severity: event.target.value }))}>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </label>
          </div>

          <div className="button-row">
            <button className="button" disabled={isPending || !blockerForm.title.trim()} onClick={handleCreateBlocker} type="button">
              Record Blocker
            </button>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Reroute</p>
              <h2>Suggested next step for the latest blocker</h2>
            </div>
          </div>

          {latestBlocker ? (
            <div className="draft-stack">
              <div>
                <div className="pill-row">
                  <StatusPill label={latestBlocker.blockerType} />
                  <StatusPill label={latestBlocker.severity} />
                  <StatusPill label={latestBlocker.status} />
                </div>
                <h3>{latestBlocker.title}</h3>
                <p className="muted">{latestBlocker.description}</p>
              </div>
              <div>
                <p className="eyebrow">Suggested Next Step</p>
                <p>{latestBlocker.suggestedNextStep || "Record a blocker to get a reroute suggestion."}</p>
              </div>
            </div>
          ) : (
            <p className="muted">No blocker yet. Record the stall when it happens so restart becomes easier.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}