"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { getLabel, localizeRuntimeError } from "@/lib/quest-agent/copy";
import type { MapDraft } from "@/lib/quest-agent/types";

export function MapPageClient() {
  const router = useRouter();
  const { state, aiEnabled, clientStorageMode, generateMap, replaceMap } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = locale === "ja"
    ? {
        page: "進め方",
        noFocusTitle: "まだ本丸が決まっていません。",
        noFocusBody: "進め方は本丸ごとに持つので、先にポートフォリオで前に置くゴールを1つ決めます。",
        openPortfolio: "ポートフォリオを開く",
        heroTitle: "本丸を、再開しやすい段階と作業に分けます。",
        lead: "進め方は大きな計画ではなく、戻りやすい順番づけです。マイルストーンと作業を小さく切って、今日の判断を軽くします。",
        generateAi: "AI で下書きを作る",
        generateHeuristic: "ルールで下書きを作る",
        saveRoute: "進め方を保存",
        storedRoute: "保存済みの進め方",
        storedLead: "いまの本丸にひもづくルート",
        draftTitle: "編集用の下書き",
        draftLead: "保存前に言い回しと粒度を整える",
        emptyStored: "まだ保存済みの進め方はありません。下書きを作ってから保存します。",
        emptyDraft: "下書きを作ると、ここでマイルストーンと作業を調整できます。",
        messages: {
          generatedAi: "AI が進め方の下書きを作りました。",
          generatedHeuristic: "ルールで進め方の下書きを作りました。",
          saved: "進め方を保存しました。次は今日の進め方を決めます。",
        },
        errors: {
          generate: "進め方の下書きを作れませんでした。",
          save: "進め方を保存できませんでした。",
        },
        fields: {
          routeSummary: "進め方の要約",
          milestoneTitle: "段階の名前",
          targetDate: "目安日",
          description: "説明",
          questTitle: "作業名",
          priority: "優先度",
          type: "種類",
          minutes: "見積もり時間",
          dueDate: "期限",
        },
        milestoneLabel: "段階",
      }
    : {
        page: "Quest Map",
        noFocusTitle: "Select a focus goal first.",
        noFocusBody: "Each route belongs to one focus goal, so pick the goal that should stay in front before editing the map.",
        openPortfolio: "Open Portfolio",
        heroTitle: "Break the focus goal into resumable stages and quests.",
        lead: "The map is not a giant plan. It is a route you can restart. Keep milestones and quests small so today stays easy to choose.",
        generateAi: "Generate draft with AI",
        generateHeuristic: "Generate draft heuristically",
        saveRoute: "Save route",
        storedRoute: "Stored route",
        storedLead: "The route attached to the current focus goal",
        draftTitle: "Editable draft",
        draftLead: "Tune wording and scope before saving",
        emptyStored: "No saved route yet. Generate a draft first.",
        emptyDraft: "Generate a draft to edit milestones and quests here.",
        messages: {
          generatedAi: "AI drafted a route.",
          generatedHeuristic: "Heuristic mode drafted a route.",
          saved: "Route saved. Next, decide today's route.",
        },
        errors: {
          generate: "Quest Map generation failed.",
          save: "Failed to save Quest Map.",
        },
        fields: {
          routeSummary: "Route summary",
          milestoneTitle: "Milestone title",
          targetDate: "Target date",
          description: "Description",
          questTitle: "Quest title",
          priority: "Priority",
          type: "Type",
          minutes: "Minutes",
          dueDate: "Due date",
        },
        milestoneLabel: "Milestone",
      };
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<MapDraft | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
          <button className="button" onClick={handleGenerate} disabled={isPending} type="button">
            {aiEnabled ? copy.generateAi : copy.generateHeuristic}
          </button>
          <button className="button button--secondary" onClick={handleSave} disabled={isPending || !draft} type="button">
            {copy.saveRoute}
          </button>
        </div>
      </section>

      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <div className="two-column two-column--wide">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.storedRoute}</p>
              <h2>{state.currentGoal.title}</h2>
              <p className="muted">{copy.storedLead}</p>
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
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.draftTitle}</p>
              <h2>{copy.draftLead}</h2>
            </div>
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
    </div>
  );
}
