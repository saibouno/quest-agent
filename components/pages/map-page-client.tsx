"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { DisclosureSection } from "@/components/shared/disclosure-section";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { getCopy, getLabel, localizeRuntimeError } from "@/lib/quest-agent/copy";
import { findLatestIntakeSnapshot } from "@/lib/quest-agent/derive";
import type { MapDraft, UiLocale } from "@/lib/quest-agent/types";

function getMapModeCopy(locale: UiLocale, mode: "workspace" | "onboarding") {
  if (mode === "workspace") {
    return {
      eyebrow: getCopy(locale).map.page,
      noGoalHref: "/portfolio",
      noGoalLabel: getCopy(locale).map.openPortfolio,
      snapshotTitle: locale === "ja" ? "Intake メモ" : "Intake note",
      snapshotLead: locale === "ja" ? "必要なときだけ、goal 作成時の確認メモを見返せます。" : "Reopen the intake confirmation note only when you need it.",
    };
  }

  return locale === "ja"
    ? {
        eyebrow: "Onboarding",
        noGoalHref: "/onboarding/intake",
        noGoalLabel: "Goal Intake に戻る",
        snapshotTitle: "確認メモ",
        snapshotLead: "このメモを見ながら最初の route を決めます。",
      }
    : {
        eyebrow: "Onboarding",
        noGoalHref: "/onboarding/intake",
        noGoalLabel: "Back to Goal Intake",
        snapshotTitle: "Confirmation note",
        snapshotLead: "Use this note to shape the first route.",
      };
}

type MapPageClientProps = {
  mode: "workspace" | "onboarding";
};

export function MapPageClient({ mode }: MapPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, aiEnabled, clientStorageMode, generateMap, replaceMap } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale).map;
  const commonCopy = getCopy(locale).common;
  const modeCopy = getMapModeCopy(locale, mode);
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<MapDraft | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const requestedGoalId = mode === "onboarding" ? searchParams.get("goalId") : null;
  const selectedGoal = requestedGoalId
    ? state.goals.find((goal) => goal.id === requestedGoalId) ?? null
    : state.currentGoal;
  const selectedMilestones = useMemo(
    () => (selectedGoal
      ? state.milestones
        .filter((milestone) => milestone.goalId === selectedGoal.id)
        .sort((left, right) => left.sequence - right.sequence)
      : []),
    [selectedGoal, state.milestones],
  );
  const selectedQuests = useMemo(
    () => (selectedGoal
      ? state.quests
        .filter((quest) => quest.goalId === selectedGoal.id)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      : []),
    [selectedGoal, state.quests],
  );
  const selectedSnapshot = selectedGoal ? findLatestIntakeSnapshot(state.events, selectedGoal.id) : null;

  const storedQuestCount = useMemo(
    () => selectedMilestones.reduce((sum, milestone) => sum + selectedQuests.filter((quest) => quest.milestoneId === milestone.id).length, 0),
    [selectedMilestones, selectedQuests],
  );

  if (!selectedGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">{modeCopy.eyebrow}</p>
        <h1>{copy.noFocusTitle}</h1>
        <p className="muted">{copy.noFocusBody}</p>
        <Link className="button" href={modeCopy.noGoalHref}>
          {modeCopy.noGoalLabel}
        </Link>
      </SectionCard>
    );
  }

  const goal = selectedGoal;

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
          goalId: goal.id,
          title: goal.title,
          description: goal.description,
          why: goal.why,
          deadline: goal.deadline,
          successCriteria: goal.successCriteria,
          currentState: goal.currentState,
          constraints: goal.constraints,
          concerns: goal.concerns,
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
          goalId: goal.id,
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
          <p className="eyebrow">{modeCopy.eyebrow}</p>
          <h1>{copy.heroTitle}</h1>
          {copy.lead ? <p className="lead">{copy.lead}</p> : null}
        </div>
        <div className="hero-panel__actions">
          <button className="button button--secondary" disabled={isPending} onClick={handleGenerate} type="button">
            {aiEnabled ? copy.generateAi : copy.generateHeuristic}
          </button>
          <button className="button" disabled={isPending || !draft} onClick={handleSave} type="button">
            {copy.saveRoute}
          </button>
        </div>
      </section>

      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      {mode === "onboarding" && selectedSnapshot ? (
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{modeCopy.snapshotTitle}</p>
              <h2>{goal.title}</h2>
              <p className="muted">{modeCopy.snapshotLead}</p>
            </div>
            <StatusPill label={selectedSnapshot.refinementMode} />
          </div>
          <div className="stack-lg">
            <div>
              <p className="eyebrow">{copy.fields.routeSummary}</p>
              <p>{selectedSnapshot.firstRouteNote || commonCopy.noData}</p>
            </div>
            <div>
              <p className="eyebrow">{getCopy(locale).intake.draftLabels.questions}</p>
              {selectedSnapshot.openQuestions.length ? (
                <ul className="bullet-list">
                  {selectedSnapshot.openQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{commonCopy.noData}</p>
              )}
            </div>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">{copy.storedRoute}</p>
            <h2>{goal.title}</h2>
            <p className="muted">{copy.storedLead}</p>
          </div>
          <StatusPill label={goal.status} />
        </div>
        <div className="pill-row">
          <span className="pill">{copy.milestoneLabel} {selectedMilestones.length}</span>
          <span className="pill">{copy.fields.questTitle} {storedQuestCount}</span>
        </div>
      </SectionCard>

      {mode === "workspace" && selectedSnapshot ? (
        <DisclosureSection
          eyebrow={modeCopy.snapshotTitle}
          title={modeCopy.snapshotTitle}
          summary={selectedSnapshot.firstRouteNote || modeCopy.snapshotLead}
          initialOpen={false}
          openLabel={commonCopy.showDetails}
          closeLabel={commonCopy.hideDetails}
          aside={<StatusPill label={selectedSnapshot.refinementMode} />}
        >
          <div className="stack-md">
            <p>{selectedSnapshot.firstRouteNote || commonCopy.noData}</p>
            {selectedSnapshot.openQuestions.length ? (
              <ul className="bullet-list">
                {selectedSnapshot.openQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">{modeCopy.snapshotLead}</p>
            )}
          </div>
        </DisclosureSection>
      ) : null}

      <DisclosureSection
        eyebrow={copy.storedRoute}
        title={copy.storedRoute}
        summary={selectedMilestones.length ? `${copy.milestoneLabel} ${selectedMilestones.length} / ${copy.fields.questTitle} ${storedQuestCount}` : copy.emptyStored}
        initialOpen={false}
        openLabel={commonCopy.showDetails}
        closeLabel={commonCopy.hideDetails}
      >
        {selectedMilestones.length ? (
          <div className="stack-lg">
            {selectedMilestones.map((milestone) => {
              const quests = selectedQuests.filter((quest) => quest.milestoneId === milestone.id);
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

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">{copy.draftTitle}</p>
            <h2>{copy.draftLead}</h2>
            <p className="muted">{draft ? draft.routeSummary : copy.emptyDraft}</p>
          </div>
          {draft ? <StatusPill label={draft.mode} /> : null}
        </div>

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
      </SectionCard>
    </div>
  );
}
