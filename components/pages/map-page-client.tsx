"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import type { MapDraft } from "@/lib/quest-agent/types";

export function MapPageClient() {
  const router = useRouter();
  const { state, aiEnabled, clientStorageMode, generateMap, replaceMap } = useQuestAgent();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<MapDraft | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!state.currentGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">Quest Map</p>
        <h1>Complete Quest Intake first.</h1>
        <p className="muted">You need one active goal before the agent can draft a route.</p>
        <Link className="button" href="/intake">
          Back to Quest Intake
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

  function updateQuest(
    milestoneIndex: number,
    questIndex: number,
    field: "title" | "description" | "priority" | "dueDate" | "estimatedMinutes" | "questType",
    value: string,
  ) {
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
      try {
        const nextDraft = await generateMap({
          goalId: state.currentGoal!.id,
          title: state.currentGoal!.title,
          description: state.currentGoal!.description,
          why: state.currentGoal!.why,
          deadline: state.currentGoal!.deadline,
          successCriteria: state.currentGoal!.successCriteria,
          currentState: state.currentGoal!.currentState,
          constraints: state.currentGoal!.constraints,
          concerns: state.currentGoal!.concerns,
        });
        setDraft(nextDraft);
        setMessage(nextDraft.mode === "ai" ? "AI drafted a route." : "Heuristic mode drafted a route.");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Quest Map generation failed.");
      }
    });
  }

  function handleSave() {
    if (!draft) {
      return;
    }
    setMessage("");
    setError("");
    startTransition(async () => {
      try {
        await replaceMap({
          goalId: state.currentGoal!.id,
          routeSummary: draft.routeSummary,
          milestones: draft.milestones,
          mode: draft.mode,
        });
        setMessage("Quest Map saved. Next, decide today's route.");
        if (clientStorageMode === "server-backed") {
          router.refresh();
        }
        router.push("/today");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to save Quest Map.");
      }
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">Quest Map</p>
          <h1>Break the goal into milestones and quests.</h1>
          <p className="lead">This does not need to be perfect. Build a route you can start, then improve it through review and reroute.</p>
        </div>
        <div className="hero-panel__actions">
          <button className="button" onClick={handleGenerate} disabled={isPending} type="button">
            {aiEnabled ? "Generate with AI" : "Generate heuristically"}
          </button>
          <button className="button button--secondary" onClick={handleSave} disabled={isPending || !draft} type="button">
            Save Route
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
            <p className="muted">No saved route yet. Generate a draft and save it.</p>
          )}
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Editable Draft</p>
              <h2>Tune the route before saving</h2>
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
            <p className="muted">Generate a route draft to edit milestones and quests here.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}