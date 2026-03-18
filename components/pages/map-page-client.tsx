"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { DisclosureSection } from "@/components/shared/disclosure-section";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { getCopy, getLabel, localizeRuntimeError } from "@/lib/quest-agent/copy";
import type { MapDraft } from "@/lib/quest-agent/types";

export function MapPageClient() {
  const router = useRouter();
  const { state, aiEnabled, clientStorageMode, generateMap, replaceMap } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale).map;
  const commonCopy = getCopy(locale).common;
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<MapDraft | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const storedQuestCount = useMemo(
    () => state.currentMilestones.reduce((sum, milestone) => sum + state.currentQuests.filter((quest) => quest.milestoneId === milestone.id).length, 0),
    [state.currentMilestones, state.currentQuests],
  );

  if (!state.currentGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">{copy.page}</p>
        <h1>{copy.noFocusTitle}</h1>
        <p className="muted">{copy.noFocusBody}</p>
        <Link className="button" href="/portfolio">
          {copy.openPortfolio}
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
          locale,
        });
        setDraft(nextDraft);
        setMessage(nextDraft.mode === "ai" ? copy.messages.generatedAi : copy.messages.generatedHeuristic);
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.errors.generate));
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
        setMessage(copy.messages.saved);
        if (clientStorageMode === "server-backed") {
          router.refresh();
        }
        router.push("/today");
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.errors.save));
      }
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">{copy.page}</p>
          <h1>{copy.heroTitle}</h1>
          <p className="lead">{copy.lead}</p>
        </div>
        <div className="hero-panel__actions">
          <button className="button button--secondary" onClick={handleGenerate} disabled={isPending} type="button">
            {aiEnabled ? copy.generateAi : copy.generateHeuristic}
          </button>
          <button className="button" onClick={handleSave} disabled={isPending || !draft} type="button">
            {copy.saveRoute}
          </button>
        </div>
      </section>

      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">{copy.storedRoute}</p>
            <h2>{state.currentGoal.title}</h2>
            <p className="muted">{copy.storedLead}</p>
          </div>
          <StatusPill label={state.currentGoal.status} />
        </div>
        <div className="pill-row">
          <span className="pill">{copy.milestoneLabel} {state.currentMilestones.length}</span>
          <span className="pill">{copy.fields.questTitle} {storedQuestCount}</span>
        </div>
      </SectionCard>

      <DisclosureSection
        eyebrow={copy.storedRoute}
        title={copy.storedRoute}
        summary={state.currentMilestones.length ? `${copy.milestoneLabel} ${state.currentMilestones.length} ・ ${copy.fields.questTitle} ${storedQuestCount}` : copy.emptyStored}
        initialOpen={false}
        openLabel={commonCopy.showDetails}
        closeLabel={commonCopy.hideDetails}
      >
        {state.currentMilestones.length ? (
          <div className="stack-lg">
            {state.currentMilestones.map((milestone) => {
              const quests = state.currentQuests.filter((quest) => quest.milestoneId === milestone.id);
              return (
                <div className="milestone-card" key={milestone.id}>
                  <div className="milestone-card__header">
                    <div>
                      <p className="eyebrow">{copy.milestoneLabel} {milestone.sequence}</p>
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
          <p className="muted">{copy.emptyStored}</p>
        )}
      </DisclosureSection>

      <DisclosureSection
        eyebrow={copy.draftTitle}
        title={copy.draftLead}
        summary={draft ? draft.routeSummary : copy.emptyDraft}
        initialOpen={Boolean(draft)}
        openLabel={commonCopy.showDetails}
        closeLabel={commonCopy.hideDetails}
        aside={draft ? <StatusPill label={draft.mode} /> : null}
      >
        {draft ? (
          <div className="stack-lg">
            <label className="field field--full">
              <span>{copy.fields.routeSummary}</span>
              <textarea
                className="textarea"
                rows={3}
                value={draft.routeSummary}
                onChange={(event) => setDraft((current) => (current ? { ...current, routeSummary: event.target.value } : current))}
              />
            </label>

            {draft.milestones.map((milestone, milestoneIndex) => (
              <div className="milestone-card" key={milestone.tempId}>
                <div className="form-grid">
                  <label className="field">
                    <span>{copy.fields.milestoneTitle}</span>
                    <input className="input" value={milestone.title} onChange={(event) => updateMilestone(milestoneIndex, "title", event.target.value)} />
                  </label>
                  <label className="field">
                    <span>{copy.fields.targetDate}</span>
                    <input className="input" type="date" value={milestone.targetDate ?? ""} onChange={(event) => updateMilestone(milestoneIndex, "targetDate", event.target.value)} />
                  </label>
                  <label className="field field--full">
                    <span>{copy.fields.description}</span>
                    <textarea className="textarea" rows={3} value={milestone.description} onChange={(event) => updateMilestone(milestoneIndex, "description", event.target.value)} />
                  </label>
                </div>

                <div className="stack-md">
                  {milestone.quests.map((quest, questIndex) => (
                    <div className="quest-edit-card" key={`${milestone.tempId}-${questIndex}`}>
                      <label className="field field--full">
                        <span>{copy.fields.questTitle}</span>
                        <input className="input" value={quest.title} onChange={(event) => updateQuest(milestoneIndex, questIndex, "title", event.target.value)} />
                      </label>
                      <label className="field field--full">
                        <span>{copy.fields.description}</span>
                        <textarea className="textarea" rows={2} value={quest.description} onChange={(event) => updateQuest(milestoneIndex, questIndex, "description", event.target.value)} />
                      </label>
                      <div className="form-grid form-grid--tight">
                        <label className="field">
                          <span>{copy.fields.priority}</span>
                          <select className="input" value={quest.priority} onChange={(event) => updateQuest(milestoneIndex, questIndex, "priority", event.target.value)}>
                            <option value="high">{getLabel(locale, "high")}</option>
                            <option value="medium">{getLabel(locale, "medium")}</option>
                            <option value="low">{getLabel(locale, "low")}</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>{copy.fields.type}</span>
                          <select className="input" value={quest.questType} onChange={(event) => updateQuest(milestoneIndex, questIndex, "questType", event.target.value)}>
                            <option value="main">{getLabel(locale, "main")}</option>
                            <option value="side">{getLabel(locale, "side")}</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>{copy.fields.minutes}</span>
                          <input className="input" type="number" min={5} step={5} value={quest.estimatedMinutes ?? ""} onChange={(event) => updateQuest(milestoneIndex, questIndex, "estimatedMinutes", event.target.value)} />
                        </label>
                        <label className="field">
                          <span>{copy.fields.dueDate}</span>
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
          <p className="muted">{copy.emptyDraft}</p>
        )}
      </DisclosureSection>
    </div>
  );
}