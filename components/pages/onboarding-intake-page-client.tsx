"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { getCopy, getLabel, localizeRuntimeError } from "@/lib/quest-agent/copy";
import type { IntakeRefinement, UiLocale } from "@/lib/quest-agent/types";

function linesToString(values: string[]) {
  return values.join("\n");
}

function stringToLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getOnboardingCopy(locale: UiLocale) {
  return locale === "ja"
    ? {
        eyebrow: "Onboarding",
        title: "Goal Intake",
        lead: "新しい goal は、いきなり一覧に足さずに、短い intake から route までつなげます。",
        steps: [
          { title: "Goal", help: "やること、なぜ今か、期限を固めます。" },
          { title: "Success", help: "done 条件と制約をはっきりさせます。" },
          { title: "State", help: "現状、気がかり、今日の容量を書きます。" },
          { title: "Confirm", help: "refine 結果を確認して保存します。" },
        ],
        buttons: {
          back: "戻る",
          next: "次へ",
          refine: "Refine する",
          save: "Quest Map へ進む",
        },
        summaryTitle: "確認メモ",
        summaryEmpty: "まず refine を実行すると、確認メモがここに出ます。",
        snapshotTitle: "保存される確認メモ",
        saveHint: "このメモは goal の最新 snapshot として保存され、Quest Map でも再利用されます。",
      }
    : {
        eyebrow: "Onboarding",
        title: "Goal Intake",
        lead: "New goals go through a short intake before they become part of the regular workspace.",
        steps: [
          { title: "Goal", help: "Capture the goal, why now, and any deadline." },
          { title: "Success", help: "Clarify done conditions and constraints." },
          { title: "State", help: "Describe the current state, concerns, and today's capacity." },
          { title: "Confirm", help: "Review the refinement note and save it." },
        ],
        buttons: {
          back: "Back",
          next: "Next",
          refine: "Refine",
          save: "Continue to Quest Map",
        },
        summaryTitle: "Confirmation note",
        summaryEmpty: "Run refine first and the confirmation note will appear here.",
        snapshotTitle: "What will be saved",
        saveHint: "This note is saved as the latest goal snapshot and reused in Quest Map.",
      };
}

export function OnboardingIntakePageClient() {
  const router = useRouter();
  const { state, aiEnabled, clientStorageMode, refineIntake, saveGoal } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale);
  const onboarding = getOnboardingCopy(locale);
  const [isPending, startTransition] = useTransition();
  const [currentStep, setCurrentStep] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refinement, setRefinement] = useState<IntakeRefinement | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    why: "",
    deadline: "",
    successCriteria: "",
    currentState: "",
    constraints: "",
    concerns: "",
    todayCapacity: "",
  });

  function updateField(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function goToStep(index: number) {
    if (index < 0 || index > 3) {
      return;
    }
    setCurrentStep(index);
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
        setMessage(nextRefinement.mode === "ai" ? copy.intake.messages.refinedAi : copy.intake.messages.refinedHeuristic);
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.intake.errors.refine));
      }
    });
  }

  function handleSave() {
    if (!refinement) {
      return;
    }

    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const nextStatus = state.portfolioStats.availableSlots > 0 ? "active" : "paused";
        const goal = await saveGoal({
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
          refined: true,
          intakeSnapshot: {
            openQuestions: refinement.openQuestions,
            firstRouteNote: refinement.firstRouteNote,
            refinementMode: refinement.mode,
          },
        });

        if (clientStorageMode === "server-backed") {
          router.refresh();
        }

        router.push(`/onboarding/map?goalId=${goal.id}`);
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.intake.errors.save));
      }
    });
  }

  const stepStates = onboarding.steps.map((_, index) => (
    index === currentStep ? "current" : index < currentStep ? "complete" : "upcoming"
  ));
  const stepReady = [
    Boolean(form.title.trim() && form.why.trim()),
    Boolean(form.successCriteria.trim() || form.constraints.trim()),
    Boolean(form.currentState.trim() || form.concerns.trim() || form.todayCapacity.trim()),
    Boolean(refinement),
  ];

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">{onboarding.eyebrow}</p>
          <h1>{onboarding.title}</h1>
          <p className="lead">{onboarding.lead}</p>
        </div>
      </section>

      <div className="step-strip">
        {onboarding.steps.map((step, index) => {
          const stateLabel = stepStates[index] === "current"
            ? copy.returnFlow.stepState.current
            : stepStates[index] === "complete"
              ? copy.returnFlow.stepState.complete
              : copy.returnFlow.stepState.upcoming;

          return (
            <button
              key={step.title}
              className={`step-chip step-chip--${stepStates[index]}`}
              disabled={index > currentStep + 1 || (index > 0 && !stepReady[index - 1])}
              onClick={() => goToStep(index)}
              type="button"
            >
              <span className="step-chip__index">{index + 1}</span>
              <span className="step-chip__body">
                <strong>{step.title}</strong>
                <span>{stateLabel}</span>
              </span>
            </button>
          );
        })}
      </div>

      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">{onboarding.steps[currentStep].title}</p>
            <h2>{onboarding.steps[currentStep].help}</h2>
          </div>
        </div>

        {currentStep === 0 ? (
          <div className="form-grid">
            <label className="field">
              <span>{copy.intake.fields.title}</span>
              <input className="input" value={form.title} onChange={(event) => updateField("title", event.target.value)} />
            </label>
            <label className="field">
              <span>{copy.intake.fields.deadline}</span>
              <input className="input" type="date" value={form.deadline} onChange={(event) => updateField("deadline", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>{copy.intake.fields.why}</span>
              <textarea className="textarea" rows={4} value={form.why} onChange={(event) => updateField("why", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>{copy.intake.fields.description}</span>
              <textarea className="textarea" rows={4} value={form.description} onChange={(event) => updateField("description", event.target.value)} />
            </label>
            <div className="button-row field--full">
              <button className="button" disabled={!form.title.trim() || !form.why.trim()} onClick={() => goToStep(1)} type="button">
                {onboarding.buttons.next}
              </button>
            </div>
          </div>
        ) : null}

        {currentStep === 1 ? (
          <div className="form-grid">
            <label className="field field--full">
              <span>{copy.intake.fields.successCriteria}</span>
              <textarea className="textarea" rows={5} value={form.successCriteria} onChange={(event) => updateField("successCriteria", event.target.value)} placeholder={copy.intake.fields.successCriteriaPlaceholder} />
            </label>
            <label className="field field--full">
              <span>{copy.intake.fields.constraints}</span>
              <textarea className="textarea" rows={5} value={form.constraints} onChange={(event) => updateField("constraints", event.target.value)} placeholder={copy.intake.fields.constraintsPlaceholder} />
            </label>
            <div className="button-row field--full">
              <button className="button button--ghost" onClick={() => goToStep(0)} type="button">
                {onboarding.buttons.back}
              </button>
              <button className="button" onClick={() => goToStep(2)} type="button">
                {onboarding.buttons.next}
              </button>
            </div>
          </div>
        ) : null}

        {currentStep === 2 ? (
          <div className="form-grid">
            <label className="field field--full">
              <span>{copy.intake.fields.currentState}</span>
              <textarea className="textarea" rows={4} value={form.currentState} onChange={(event) => updateField("currentState", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>{copy.intake.fields.concerns}</span>
              <textarea className="textarea" rows={4} value={form.concerns} onChange={(event) => updateField("concerns", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>{copy.intake.fields.todayCapacity}</span>
              <textarea className="textarea" rows={3} value={form.todayCapacity} onChange={(event) => updateField("todayCapacity", event.target.value)} placeholder={copy.intake.fields.todayCapacityPlaceholder} />
            </label>
            <div className="button-row field--full">
              <button className="button button--ghost" onClick={() => goToStep(1)} type="button">
                {onboarding.buttons.back}
              </button>
              <button className="button" onClick={() => goToStep(3)} type="button">
                {onboarding.buttons.next}
              </button>
            </div>
          </div>
        ) : null}

        {currentStep === 3 ? (
          <div className="stack-lg">
            <div className="button-row">
              <button className="button button--secondary" disabled={isPending || !form.title.trim()} onClick={handleRefine} type="button">
                {aiEnabled ? `${onboarding.buttons.refine} AI` : onboarding.buttons.refine}
              </button>
              <button className="button" disabled={isPending || !form.title.trim() || !refinement} onClick={handleSave} type="button">
                {onboarding.buttons.save}
              </button>
            </div>

            <div className="queue-card">
              <p className="eyebrow">{onboarding.summaryTitle}</p>
              {refinement ? (
                <div className="stack-md">
                  <div className="pill-row">
                    <span className="pill">{getLabel(locale, refinement.mode)}</span>
                  </div>
                  <p>{refinement.goalSummary}</p>
                  <div>
                    <p className="eyebrow">{copy.intake.draftLabels.success}</p>
                    <ul className="bullet-list">
                      {refinement.successCriteria.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="eyebrow">{copy.intake.draftLabels.questions}</p>
                    <ul className="bullet-list">
                      {refinement.openQuestions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="eyebrow">{copy.intake.draftLabels.route}</p>
                    <p>{refinement.firstRouteNote}</p>
                  </div>
                </div>
              ) : (
                <p className="muted">{onboarding.summaryEmpty}</p>
              )}
            </div>

            <div className="queue-card">
              <p className="eyebrow">{onboarding.snapshotTitle}</p>
              <p className="muted">{onboarding.saveHint}</p>
            </div>

            <div className="button-row">
              <button className="button button--ghost" onClick={() => goToStep(2)} type="button">
                {onboarding.buttons.back}
              </button>
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
