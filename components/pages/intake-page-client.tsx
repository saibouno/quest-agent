"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { StatStrip } from "@/components/shared/stat-strip";
import { getLabel, localizeRuntimeError } from "@/lib/quest-agent/copy";
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
  const locale = state.uiPreferences.locale;
  const copy = locale === "ja"
    ? {
        page: "受け取り",
        titleNew: "新しいゴールを、無理なくポートフォリオに入れます。",
        titleEdit: "ゴールを、実際に動かせる形に整えます。",
        lead: "受け取りはポートフォリオ前提です。進行中の枠が空いていなくても、あとで動かせる形で先に残せます。",
        refineAi: "AI で整える",
        refineHeuristic: "ルールで整える",
        saveGoal: "ゴールを保存",
        stats: {
          focus: "本丸",
          active: "進行中",
          resume: "再開待ち",
          momentum: "前進数",
        },
        details: {
          noFocus: "まだ本丸はありません",
          active: "現在の同時進行数",
          resume: "再開メモ付きで止めたもの",
          momentum: "直近7日で終えた作業",
        },
        formTitle: "ゴール入力",
        formLeadNew: "新しいゴールを記録する",
        formLeadEdit: "最小入力で十分です",
        draftTitle: "整えた下書き",
        draftLead: "いまの情報から見えていること",
        fields: {
          title: "ゴール名",
          description: "ゴールの説明",
          why: "やる理由",
          deadline: "期限",
          successCriteria: "成功条件",
          successCriteriaPlaceholder: "1行に1つずつ",
          currentState: "いまの状態",
          constraints: "制約",
          constraintsPlaceholder: "1行に1つずつ",
          concerns: "気がかり / 止まりそうな点",
          todayCapacity: "今日に使える時間や余力",
          todayCapacityPlaceholder: "今日どれくらい現実的に使えそうか",
        },
        draftLabels: {
          mode: "モード",
          summary: "要約",
          success: "成功条件",
          questions: "確認したいこと",
          route: "最初の進め方メモ",
        },
        messages: {
          refinedAi: "AI がゴールを整えました。",
          refinedHeuristic: "ルールでゴールを整えました。",
          savedActive: "ゴールを保存しました。次は進め方を作ります。",
          savedBacklog: "ゴールを保存しました。枠が空いたらポートフォリオから動かせます。",
          emptyDraft: "整えるボタンで、あいまいなゴールを作業しやすい下書きにできます。",
        },
        errors: {
          refine: "ゴールを整えられませんでした。",
          save: "ゴールを保存できませんでした。",
        },
      }
    : {
        page: "Intake",
        titleNew: "Add a goal without breaking the portfolio balance.",
        titleEdit: "Shape the goal into something you can actually move.",
        lead: "Intake now assumes the portfolio. Even when no active slot is open, you can capture the goal cleanly for later.",
        refineAi: "Refine with AI",
        refineHeuristic: "Refine with heuristics",
        saveGoal: "Save goal",
        stats: {
          focus: "Focus goal",
          active: "Active goals",
          resume: "Resume queue",
          momentum: "Momentum",
        },
        details: {
          noFocus: "No focus selected",
          active: "Current active count",
          resume: "Goals parked with restart notes",
          momentum: "Completed quests in the last 7 days",
        },
        formTitle: "Goal form",
        formLeadNew: "Capture a new goal",
        formLeadEdit: "Minimum input is enough",
        draftTitle: "Agent draft",
        draftLead: "What the agent sees",
        fields: {
          title: "Goal title",
          description: "Goal summary",
          why: "Why",
          deadline: "Deadline",
          successCriteria: "Success criteria",
          successCriteriaPlaceholder: "One line per item",
          currentState: "Current state",
          constraints: "Constraints",
          constraintsPlaceholder: "One line per item",
          concerns: "Concerns / likely blockers",
          todayCapacity: "Today's capacity",
          todayCapacityPlaceholder: "How much can you realistically do today?",
        },
        draftLabels: {
          mode: "Mode",
          summary: "Goal summary",
          success: "Success criteria",
          questions: "Open questions",
          route: "First route note",
        },
        messages: {
          refinedAi: "AI drafted a sharper goal.",
          refinedHeuristic: "Heuristic mode drafted a sharper goal.",
          savedActive: "Goal saved. Next, turn it into a route on Quest Map.",
          savedBacklog: "Goal saved to the portfolio backlog. Activate it from Portfolio when a slot opens.",
          emptyDraft: "Use the refine button to turn a vague goal into a cleaner working draft.",
        },
        errors: {
          refine: "Intake refinement failed.",
          save: "Goal save failed.",
        },
      };
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refinement, setRefinement] = useState<IntakeRefinement | null>(null);
  const [form, setForm] = useState(() => buildForm(isNewMode ? null : state.focusGoal));

  const stats = [
    { label: copy.stats.focus, value: state.focusGoal ? 1 : 0, detail: state.focusGoal?.title ?? copy.details.noFocus },
    { label: copy.stats.active, value: `${state.portfolioStats.activeGoalCount}/${state.portfolioStats.wipLimit}`, detail: copy.details.active },
    { label: copy.stats.resume, value: state.portfolioStats.resumeQueueCount, detail: copy.details.resume },
    { label: copy.stats.momentum, value: state.stats.completedThisWeek, detail: copy.details.momentum },
  ];

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
          locale,
        });
        setRefinement(nextRefinement);
        setForm((current) => ({
          ...current,
          title: nextRefinement.goalTitle,
          description: nextRefinement.goalSummary,
          successCriteria: linesToString(nextRefinement.successCriteria),
          constraints: linesToString(nextRefinement.constraintsToWatch),
        }));
        setMessage(nextRefinement.mode === "ai" ? copy.messages.refinedAi : copy.messages.refinedHeuristic);
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.errors.refine));
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
          setMessage(copy.messages.savedActive);
          if (clientStorageMode === "server-backed") {
            router.refresh();
          }
          router.push("/map");
          return;
        }

        setMessage(copy.messages.savedBacklog);
        if (clientStorageMode === "server-backed") {
          router.refresh();
        }
        router.push("/portfolio");
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
          <h1>{isNewMode ? copy.titleNew : copy.titleEdit}</h1>
          <p className="lead">{copy.lead}</p>
        </div>
        <div className="hero-panel__actions">
          <button className="button" onClick={handleRefine} disabled={isPending || !form.title.trim()} type="button">
            {aiEnabled ? copy.refineAi : copy.refineHeuristic}
          </button>
          <button className="button button--secondary" onClick={handleSave} disabled={isPending || !form.title.trim()} type="button">
            {copy.saveGoal}
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
              <p className="eyebrow">{copy.formTitle}</p>
              <h2>{isNewMode ? copy.formLeadNew : copy.formLeadEdit}</h2>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>{copy.fields.title}</span>
              <input className="input" value={form.title} onChange={(event) => updateField("title", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>{copy.fields.description}</span>
              <textarea className="textarea" rows={4} value={form.description} onChange={(event) => updateField("description", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>{copy.fields.why}</span>
              <textarea className="textarea" rows={3} value={form.why} onChange={(event) => updateField("why", event.target.value)} />
            </label>
            <label className="field">
              <span>{copy.fields.deadline}</span>
              <input className="input" type="date" value={form.deadline} onChange={(event) => updateField("deadline", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>{copy.fields.successCriteria}</span>
              <textarea className="textarea" rows={4} value={form.successCriteria} onChange={(event) => updateField("successCriteria", event.target.value)} placeholder={copy.fields.successCriteriaPlaceholder} />
            </label>
            <label className="field field--full">
              <span>{copy.fields.currentState}</span>
              <textarea className="textarea" rows={4} value={form.currentState} onChange={(event) => updateField("currentState", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>{copy.fields.constraints}</span>
              <textarea className="textarea" rows={4} value={form.constraints} onChange={(event) => updateField("constraints", event.target.value)} placeholder={copy.fields.constraintsPlaceholder} />
            </label>
            <label className="field field--full">
              <span>{copy.fields.concerns}</span>
              <textarea className="textarea" rows={3} value={form.concerns} onChange={(event) => updateField("concerns", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>{copy.fields.todayCapacity}</span>
              <textarea className="textarea" rows={2} value={form.todayCapacity} onChange={(event) => updateField("todayCapacity", event.target.value)} placeholder={copy.fields.todayCapacityPlaceholder} />
            </label>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.draftTitle}</p>
              <h2>{copy.draftLead}</h2>
            </div>
          </div>

          {refinement ? (
            <div className="draft-stack">
              <div>
                <p className="eyebrow">{copy.draftLabels.mode}</p>
                <strong>{getLabel(locale, refinement.mode)}</strong>
              </div>
              <div>
                <p className="eyebrow">{copy.draftLabels.summary}</p>
                <p>{refinement.goalSummary}</p>
              </div>
              <div>
                <p className="eyebrow">{copy.draftLabels.success}</p>
                <ul className="bullet-list">
                  {refinement.successCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="eyebrow">{copy.draftLabels.questions}</p>
                <ul className="bullet-list">
                  {refinement.openQuestions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="eyebrow">{copy.draftLabels.route}</p>
                <p>{refinement.firstRouteNote}</p>
              </div>
            </div>
          ) : (
            <p className="muted">{copy.messages.emptyDraft}</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
