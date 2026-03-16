"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import type { AppState, MapDraft } from "@/lib/quest-agent/types";

export function MapPageClient({ state, aiEnabled }: { state: AppState; aiEnabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<MapDraft | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!state.currentGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">Quest Map</p>
        <h1>先に Goal Intake を完了してください。</h1>
        <p className="muted">goal がないと route を作れません。</p>
        <Link className="button" href="/intake">
          Quest Intake へ戻る
        </Link>
      </SectionCard>
    );
  }

  function updateMilestone(index: number, field: "title" | "description" | "targetDate", value: string) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const milestones = [...current.milestones];
      const milestone = milestones[index];
      milestones[index] = {
        ...milestone,
        [field]: field === "targetDate" ? value || null : value,
      };
      return { ...current, milestones };
    });
  }

  function updateQuest(milestoneIndex: number, questIndex: number, field: "title" | "description" | "priority" | "dueDate" | "estimatedMinutes" | "questType", value: string) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const milestones = [...current.milestones];
      const milestone = { ...milestones[milestoneIndex] };
      const quests = [...milestone.quests];
      const quest = { ...quests[questIndex] };
      quests[questIndex] = {
        ...quest,
        [field]: field === "estimatedMinutes" ? (value ? Number(value) : null) : field === "dueDate" ? value || null : value,
      } as typeof quest;
      milestone.quests = quests;
      milestones[milestoneIndex] = milestone;
      return { ...current, milestones };
    });
  }

  function handleGenerate() {
    setMessage("");
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/ai/generate-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId: state.currentGoal?.id,
          title: state.currentGoal?.title,
          description: state.currentGoal?.description,
          why: state.currentGoal?.why,
          deadline: state.currentGoal?.deadline,
          successCriteria: state.currentGoal?.successCriteria,
          currentState: state.currentGoal?.currentState,
          constraints: state.currentGoal?.constraints,
          concerns: state.currentGoal?.concerns,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Quest Map generation failed.");
        return;
      }
      setDraft(payload.data as MapDraft);
      setMessage(payload.data.mode === "ai" ? "AI が route draft を作成しました。" : "Heuristic mode で route draft を作成しました。");
    });
  }

  function handleSave() {
    if (!draft) {
      return;
    }
    setMessage("");
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId: state.currentGoal?.id,
          routeSummary: draft.routeSummary,
          milestones: draft.milestones,
          mode: draft.mode,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Failed to save Quest Map.");
        return;
      }
      setMessage("Quest Map を保存しました。次は Today&apos;s Quests で今日の route を決めます。");
      router.refresh();
      router.push("/today");
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">Quest Map</p>
          <h1>Goal を milestone と quest に分解する。</h1>
          <p className="lead">完全な計画ではなく、今日から動ける仮 route を作ります。後から review と blocker で直せる前提です。</p>
        </div>
        <div className="hero-panel__actions">
          <button className="button" onClick={handleGenerate} disabled={isPending} type="button">
            {aiEnabled ? "AI で route を生成" : "Heuristic で route を生成"}
          </button>
          <button className="button button--secondary" onClick={handleSave} disabled={isPending || !draft} type="button">
            Route を保存
          </button>
        </div>
      </section>

      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <div className="two-column two-column--wide">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Stored Route</p>
              <h2>{state.currentGoal.title}</h2>
            </div>
            <StatusPill label={state.currentGoal.status} />
          </div>

          {state.currentMilestones.length ? (
            <div className="stack-lg">
              {state.currentMilestones.map((milestone) => {
                const quests = state.currentQuests.filter((quest) => quest.milestoneId === milestone.id);
                return (
                  <div className="milestone-card" key={milestone.id}>
                    <div className="milestone-card__header">
                      <div>
                        <p className="eyebrow">Milestone {milestone.sequence}</p>
                        <h3>{milestone.title}</h3>
                      </div>
                      <StatusPill label={milestone.status} />
                    </div>
                    <p className="muted">{milestone.description}</p>
                    <div className="quest-list">
                      {quests.map((quest) => (
                        <div className="quest-row" key={quest.id}>
                          <div>
                            <strong>{quest.title}</strong>
                            <p className="muted">{quest.description}</p>
                          </div>
                          <div className="pill-row">
                            <StatusPill label={quest.priority} />
                            <StatusPill label={quest.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">まだ route は保存されていません。まず draft を作って保存します。</p>
          )}
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Editable Draft</p>
              <h2>叩き台をその場で整える</h2>
            </div>
          </div>

          {draft ? (
            <div className="stack-lg">
              <label className="field field--full">
                <span>Route Summary</span>
                <textarea className="textarea" rows={3} value={draft.routeSummary} onChange={(event) => setDraft((current) => (current ? { ...current, routeSummary: event.target.value } : current))} />
              </label>

              {draft.milestones.map((milestone, milestoneIndex) => (
                <div className="milestone-card" key={milestone.tempId}>
                  <div className="form-grid">
                    <label className="field">
                      <span>Milestone Title</span>
                      <input className="input" value={milestone.title} onChange={(event) => updateMilestone(milestoneIndex, "title", event.target.value)} />
                    </label>
                    <label className="field">
                      <span>Target Date</span>
                      <input className="input" type="date" value={milestone.targetDate ?? ""} onChange={(event) => updateMilestone(milestoneIndex, "targetDate", event.target.value)} />
                    </label>
                    <label className="field field--full">
                      <span>Description</span>
                      <textarea className="textarea" rows={3} value={milestone.description} onChange={(event) => updateMilestone(milestoneIndex, "description", event.target.value)} />
                    </label>
                  </div>

                  <div className="stack-md">
                    {milestone.quests.map((quest, questIndex) => (
                      <div className="quest-edit-card" key={`${milestone.tempId}-${questIndex}`}>
                        <label className="field field--full">
                          <span>Quest Title</span>
                          <input className="input" value={quest.title} onChange={(event) => updateQuest(milestoneIndex, questIndex, "title", event.target.value)} />
                        </label>
                        <label className="field field--full">
                          <span>Description</span>
                          <textarea className="textarea" rows={2} value={quest.description} onChange={(event) => updateQuest(milestoneIndex, questIndex, "description", event.target.value)} />
                        </label>
                        <div className="form-grid form-grid--tight">
                          <label className="field">
                            <span>Priority</span>
                            <select className="input" value={quest.priority} onChange={(event) => updateQuest(milestoneIndex, questIndex, "priority", event.target.value)}>
                              <option value="high">high</option>
                              <option value="medium">medium</option>
                              <option value="low">low</option>
                            </select>
                          </label>
                          <label className="field">
                            <span>Type</span>
                            <select className="input" value={quest.questType} onChange={(event) => updateQuest(milestoneIndex, questIndex, "questType", event.target.value)}>
                              <option value="main">main</option>
                              <option value="side">side</option>
                            </select>
                          </label>
                          <label className="field">
                            <span>Minutes</span>
                            <input className="input" type="number" min={5} step={5} value={quest.estimatedMinutes ?? ""} onChange={(event) => updateQuest(milestoneIndex, questIndex, "estimatedMinutes", event.target.value)} />
                          </label>
                          <label className="field">
                            <span>Due Date</span>
                            <input className="input" type="date" value={quest.dueDate ?? ""} onChange={(event) => updateQuest(milestoneIndex, questIndex, "dueDate", event.target.value)} />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">route draft を生成すると、ここで milestone と quest を編集してから保存できます。</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

