"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { findLatestArtifactNoteForGoal, findLatestDoneWhenForGoal } from "@/lib/quest-agent/derive";
import { getCopy, getLabel, localizeRuntimeError } from "@/lib/quest-agent/copy";
import type { BottleneckType, ResumeTriggerType, ReturnDecision } from "@/lib/quest-agent/types";

type ReturnFormState = {
  questId: string;
  mainQuest: string;
  primaryBottleneck: BottleneckType;
  avoidanceHypothesis: string;
  smallestWin: string;
  diagnosisType: BottleneckType;
  woopPlan: string;
  ifThenPlan: string;
  next15mAction: string;
  decision: ReturnDecision;
  decisionNote: string;
  reviewDate: string;
  parkingReason: string;
  parkingNote: string;
  nextRestartStep: string;
  resumeTriggerType: ResumeTriggerType;
  resumeTriggerText: string;
};

function formatRatio(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMinutes(locale: "ja" | "en", value: number | null) {
  if (value === null) {
    return "-";
  }
  return locale === "ja" ? `${Math.round(value)}分` : `${Math.round(value)}m`;
}

export function ReturnPageClient() {
  const router = useRouter();
  const { state, clientStorageMode, saveReturnInterview, saveReturnRun } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const latestArtifactNote = state.focusGoal ? findLatestArtifactNoteForGoal(state.workSessions, state.focusGoal.id) : "";
  const latestDoneWhen = state.focusGoal ? findLatestDoneWhenForGoal(state.buildImproveDecisions, state.focusGoal.id) : "";
  const [currentStep, setCurrentStep] = useState(0);
  const [nextRestartTouched, setNextRestartTouched] = useState(false);
  const [form, setForm] = useState<ReturnFormState>({
    questId: state.currentQuests[0]?.id ?? "",
    mainQuest: state.currentQuests[0]?.title ?? state.focusGoal?.title ?? "",
    primaryBottleneck: state.latestBottleneckInterview?.primaryBottleneck ?? "capability",
    avoidanceHypothesis: state.latestBottleneckInterview?.avoidanceHypothesis ?? state.mirrorCard.headline,
    smallestWin: state.latestBottleneckInterview?.smallestWin ?? state.currentQuests[0]?.title ?? "",
    diagnosisType: state.latestBottleneckInterview?.primaryBottleneck ?? "capability",
    woopPlan: "",
    ifThenPlan: "",
    next15mAction: "",
    decision: "fight",
    decisionNote: "",
    reviewDate: new Date().toISOString().slice(0, 10),
    parkingReason: "",
    parkingNote: latestArtifactNote,
    nextRestartStep: latestDoneWhen,
    resumeTriggerType: "manual",
    resumeTriggerText: "",
  });


  function refreshIfNeeded() {
    if (clientStorageMode === "server-backed") {
      router.refresh();
    }
  }

  function handleNext15mChange(value: string) {
    setForm((current) => {
      const shouldMirror = !nextRestartTouched && !latestDoneWhen.trim() && (!current.nextRestartStep.trim() || current.nextRestartStep === current.next15mAction);
      return {
        ...current,
        next15mAction: value,
        nextRestartStep: shouldMirror ? value : current.nextRestartStep,
      };
    });
  }

  if (!state.focusGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">{copy.nav.returnFlow}</p>
        <h1>{copy.returnFlow.noFocusTitle}</h1>
        <p className="muted">{copy.returnFlow.noFocusBody}</p>
        <Link className="button" href="/portfolio">
          {copy.common.openPortfolio}
        </Link>
      </SectionCard>
    );
  }

  const bottleneckReady = Boolean(
    form.mainQuest.trim() &&
      form.avoidanceHypothesis.trim() &&
      form.smallestWin.trim(),
  );
  const planReady = Boolean(form.woopPlan.trim() && form.next15mAction.trim());
  const holdReady = Boolean(
    form.parkingReason.trim() &&
      form.parkingNote.trim() &&
      form.nextRestartStep.trim() &&
      form.resumeTriggerText.trim(),
  );
  const retreatReady = Boolean(form.parkingReason.trim() && form.parkingNote.trim() && form.reviewDate);
  const decisionReady = form.decision === "hold" ? holdReady : form.decision === "retreat" ? retreatReady : true;

  const stepStates = [
    currentStep === 0 ? "current" : "complete",
    currentStep === 1 ? "current" : currentStep > 1 ? "complete" : "upcoming",
    currentStep === 2 ? "current" : currentStep > 2 ? "complete" : "upcoming",
    currentStep === 3 ? "current" : "upcoming",
  ] as const;

  const maxAccessibleStep = planReady ? 3 : bottleneckReady ? 2 : 1;

  const stepCards = [
    {
      title: copy.returnFlow.steps.facts,
      help: copy.returnFlow.stepHelp.facts,
      summaryLabel: copy.returnFlow.summaryLabels.facts,
      summary: state.mirrorCard.headline,
    },
    {
      title: copy.returnFlow.steps.bottleneck,
      help: copy.returnFlow.stepHelp.bottleneck,
      summaryLabel: copy.returnFlow.summaryLabels.bottleneck,
      summary: form.smallestWin.trim() || form.mainQuest.trim() || copy.common.noData,
    },
    {
      title: copy.returnFlow.steps.plan,
      help: copy.returnFlow.stepHelp.plan,
      summaryLabel: copy.returnFlow.summaryLabels.plan,
      summary: form.next15mAction.trim() || copy.common.noData,
    },
    {
      title: copy.returnFlow.steps.decision,
      help: copy.returnFlow.stepHelp.decision,
      summaryLabel: copy.returnFlow.summaryLabels.decision,
      summary: getLabel(locale, form.decision),
    },
  ];

  function goToStep(index: number) {
    if (index <= maxAccessibleStep) {
      setCurrentStep(index);
    }
  }

  function handleSave() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const interview = await saveReturnInterview({
          goalId: state.focusGoal!.id,
          mainQuest: form.mainQuest,
          primaryBottleneck: form.primaryBottleneck,
          avoidanceHypothesis: form.avoidanceHypothesis,
          smallestWin: form.smallestWin,
        });

        await saveReturnRun({
          goalId: state.focusGoal!.id,
          questId: form.questId || null,
          interviewId: interview.id,
          mirrorMessage: state.mirrorCard.headline,
          diagnosisType: form.diagnosisType,
          woopPlan: form.woopPlan,
          ifThenPlan: form.ifThenPlan,
          next15mAction: form.next15mAction,
          decision: form.decision,
          decisionNote: form.decisionNote,
          reviewDate: form.decision === "retreat" ? form.reviewDate : null,
          parkingReason: form.parkingReason,
          parkingNote: form.parkingNote,
          nextRestartStep: form.nextRestartStep,
          resumeTriggerType: form.resumeTriggerType,
          resumeTriggerText: form.resumeTriggerText,
        });

        setMessage(copy.returnFlow.messages.saved);
        refreshIfNeeded();
        router.push(form.decision === "hold" || form.decision === "retreat" ? "/portfolio" : "/today");
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, locale === "ja" ? "戻し方を保存できませんでした。" : "Failed to save return flow."));
      }
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">{copy.nav.returnFlow}</p>
          <h1>{copy.returnFlow.title}</h1>
          <p className="lead">{copy.returnFlow.lead}</p>
        </div>
        <div className="hero-panel__actions">
          <Link className="button button--secondary" href="/today">
            {copy.common.backToToday}
          </Link>
        </div>
      </section>

      <div className="step-strip">
        {stepCards.map((step, index) => {
          const stateLabel = stepStates[index] === "current"
            ? copy.returnFlow.stepState.current
            : stepStates[index] === "complete"
              ? copy.returnFlow.stepState.complete
              : copy.returnFlow.stepState.upcoming;

          return (
            <button
              key={step.title}
              className={`step-chip step-chip--${stepStates[index]}`}
              disabled={index > maxAccessibleStep}
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

      <div className="page-stack">
        <SectionCard>
          <button className="return-step-header" onClick={() => goToStep(0)} type="button">
            <div>
              <p className="eyebrow">{copy.returnFlow.steps.facts}</p>
              <h2>{state.mirrorCard.headline}</h2>
              <p className="muted">{currentStep === 0 ? copy.returnFlow.stepHelp.facts : `${copy.returnFlow.summaryLabels.facts}: ${state.mirrorCard.headline}`}</p>
            </div>
            <span className="pill">{stepStates[0] === "current" ? copy.returnFlow.stepState.current : copy.returnFlow.stepState.complete}</span>
          </button>
          {currentStep === 0 ? (
            <div className="stack-lg return-step-body">
              <div className="pill-row">
                <span className="pill">{copy.today.stats.mainToday} {state.mirrorCard.mainMinutes}{copy.common.minutes}</span>
                <span className="pill">{copy.today.stats.metaToday} {state.mirrorCard.metaMinutes}{copy.common.minutes}</span>
                <span className="pill">{copy.today.stats.switchDensity} {state.mirrorCard.switchDensity}</span>
              </div>
              <ul className="bullet-list muted-list">
                {state.mirrorCard.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
              {state.todayLeadMetrics ? (
                <div className="return-metrics-grid">
                  <div className="queue-card">
                    <p className="eyebrow">{copy.review.stats.startDelay}</p>
                    <h3>{formatMinutes(locale, state.todayLeadMetrics.startDelayMinutes)}</h3>
                  </div>
                  <div className="queue-card">
                    <p className="eyebrow">{copy.review.stats.resumeDelay}</p>
                    <h3>{formatMinutes(locale, state.todayLeadMetrics.resumeDelayMinutes)}</h3>
                  </div>
                  <div className="queue-card">
                    <p className="eyebrow">{copy.review.stats.ifThen}</p>
                    <h3>{formatRatio(state.todayLeadMetrics.ifThenCoverage)}</h3>
                  </div>
                </div>
              ) : null}
              <div className="button-row">
                <button className="button" onClick={() => setCurrentStep(1)} type="button">
                  {copy.returnFlow.buttons.next}
                </button>
              </div>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard>
          <button className="return-step-header" onClick={() => goToStep(1)} type="button">
            <div>
              <p className="eyebrow">{copy.returnFlow.steps.bottleneck}</p>
              <h2>{copy.returnFlow.combTitle}</h2>
              <p className="muted">{currentStep === 1 ? copy.returnFlow.stepHelp.bottleneck : `${copy.returnFlow.summaryLabels.bottleneck}: ${form.smallestWin.trim() || form.mainQuest.trim() || copy.common.noData}`}</p>
            </div>
            <span className="pill">{stepStates[1] === "current" ? copy.returnFlow.stepState.current : stepStates[1] === "complete" ? copy.returnFlow.stepState.complete : copy.returnFlow.stepState.upcoming}</span>
          </button>
          {currentStep === 1 ? (
            <div className="form-grid portfolio-form-grid return-step-body">
              <label className="field">
                <span>{copy.returnFlow.fields.mainQuest}</span>
                <input className="input" value={form.mainQuest} onChange={(event) => setForm((current) => ({ ...current, mainQuest: event.target.value }))} />
              </label>
              <label className="field">
                <span>{copy.returnFlow.fields.quest}</span>
                <select className="input" value={form.questId} onChange={(event) => setForm((current) => ({ ...current, questId: event.target.value }))}>
                  <option value="">{copy.common.noData}</option>
                  {state.currentQuests.map((quest) => (
                    <option key={quest.id} value={quest.id}>{quest.title}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{copy.returnFlow.fields.primaryBottleneck}</span>
                <select className="input" value={form.primaryBottleneck} onChange={(event) => setForm((current) => ({ ...current, primaryBottleneck: event.target.value as BottleneckType, diagnosisType: event.target.value as BottleneckType }))}>
                  <option value="capability">{getLabel(locale, "capability")}</option>
                  <option value="opportunity">{getLabel(locale, "opportunity")}</option>
                  <option value="motivation">{getLabel(locale, "motivation")}</option>
                  <option value="unclear">{getLabel(locale, "unclear")}</option>
                </select>
              </label>
              <label className="field">
                <span>{copy.returnFlow.fields.diagnosisType}</span>
                <select className="input" value={form.diagnosisType} onChange={(event) => setForm((current) => ({ ...current, diagnosisType: event.target.value as BottleneckType }))}>
                  <option value="capability">{getLabel(locale, "capability")}</option>
                  <option value="opportunity">{getLabel(locale, "opportunity")}</option>
                  <option value="motivation">{getLabel(locale, "motivation")}</option>
                  <option value="unclear">{getLabel(locale, "unclear")}</option>
                </select>
              </label>
              <label className="field field--full">
                <span>{copy.returnFlow.fields.avoidanceHypothesis}</span>
                <textarea className="textarea" rows={3} value={form.avoidanceHypothesis} onChange={(event) => setForm((current) => ({ ...current, avoidanceHypothesis: event.target.value }))} />
              </label>
              <label className="field field--full">
                <span>{copy.returnFlow.fields.smallestWin}</span>
                <textarea className="textarea" rows={2} value={form.smallestWin} onChange={(event) => setForm((current) => ({ ...current, smallestWin: event.target.value }))} />
              </label>
              <div className="button-row field--full">
                <button className="button button--ghost" onClick={() => setCurrentStep(0)} type="button">
                  {copy.returnFlow.buttons.back}
                </button>
                <button className="button" disabled={!bottleneckReady} onClick={() => setCurrentStep(2)} type="button">
                  {copy.returnFlow.buttons.next}
                </button>
              </div>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard>
          <button className="return-step-header" disabled={currentStep < 2 && !bottleneckReady} onClick={() => goToStep(2)} type="button">
            <div>
              <p className="eyebrow">{copy.returnFlow.steps.plan}</p>
              <h2>{copy.returnFlow.planTitle}</h2>
              <p className="muted">{currentStep === 2 ? copy.returnFlow.stepHelp.plan : `${copy.returnFlow.summaryLabels.plan}: ${form.next15mAction.trim() || copy.common.noData}`}</p>
            </div>
            <span className="pill">{stepStates[2] === "current" ? copy.returnFlow.stepState.current : stepStates[2] === "complete" ? copy.returnFlow.stepState.complete : copy.returnFlow.stepState.upcoming}</span>
          </button>
          {currentStep === 2 ? (
            <div className="form-grid return-step-body">
              <label className="field field--full">
                <span>{copy.returnFlow.fields.woopPlan}</span>
                <textarea className="textarea" rows={4} value={form.woopPlan} onChange={(event) => setForm((current) => ({ ...current, woopPlan: event.target.value }))} placeholder={copy.returnFlow.fields.woopPlaceholder} />
              </label>
              <label className="field field--full">
                <span>{copy.returnFlow.fields.ifThenPlan}</span>
                <textarea className="textarea" rows={3} value={form.ifThenPlan} onChange={(event) => setForm((current) => ({ ...current, ifThenPlan: event.target.value }))} placeholder={copy.returnFlow.fields.ifThenPlaceholder} />
              </label>
              <label className="field field--full">
                <span>{copy.returnFlow.fields.next15mAction}</span>
                <textarea className="textarea" rows={3} value={form.next15mAction} onChange={(event) => handleNext15mChange(event.target.value)} placeholder={copy.returnFlow.fields.next15mPlaceholder} />
              </label>
              <div className="button-row field--full">
                <button className="button button--ghost" onClick={() => setCurrentStep(1)} type="button">
                  {copy.returnFlow.buttons.back}
                </button>
                <button className="button" disabled={!planReady} onClick={() => setCurrentStep(3)} type="button">
                  {copy.returnFlow.buttons.next}
                </button>
              </div>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard>
          <button className="return-step-header" disabled={currentStep < 3 && !planReady} onClick={() => goToStep(3)} type="button">
            <div>
              <p className="eyebrow">{copy.returnFlow.steps.decision}</p>
              <h2>{copy.returnFlow.decisionTitle}</h2>
              <p className="muted">{currentStep === 3 ? copy.returnFlow.stepHelp.decision : `${copy.returnFlow.summaryLabels.decision}: ${getLabel(locale, form.decision)}`}</p>
            </div>
            <span className="pill">{stepStates[3] === "current" ? copy.returnFlow.stepState.current : copy.returnFlow.stepState.upcoming}</span>
          </button>
          {currentStep === 3 ? (
            <div className="form-grid portfolio-form-grid return-step-body">
              <label className="field">
                <span>{copy.returnFlow.fields.decision}</span>
                <select className="input" value={form.decision} onChange={(event) => setForm((current) => ({ ...current, decision: event.target.value as ReturnDecision }))}>
                  <option value="fight">{getLabel(locale, "fight")}</option>
                  <option value="detour">{getLabel(locale, "detour")}</option>
                  <option value="hold">{getLabel(locale, "hold")}</option>
                  <option value="retreat">{getLabel(locale, "retreat")}</option>
                </select>
              </label>
              {form.decision === "retreat" ? (
                <label className="field">
                  <span>{copy.returnFlow.fields.reviewDate}</span>
                  <input className="input" type="date" value={form.reviewDate} onChange={(event) => setForm((current) => ({ ...current, reviewDate: event.target.value }))} />
                </label>
              ) : null}
              <label className="field field--full">
                <span>{copy.returnFlow.fields.decisionNote}</span>
                <textarea className="textarea" rows={2} value={form.decisionNote} onChange={(event) => setForm((current) => ({ ...current, decisionNote: event.target.value }))} />
              </label>
              {(form.decision === "hold" || form.decision === "retreat") ? (
                <>
                  <label className="field field--full">
                    <span>{copy.returnFlow.fields.reason}</span>
                    <textarea className="textarea" rows={2} value={form.parkingReason} onChange={(event) => setForm((current) => ({ ...current, parkingReason: event.target.value }))} />
                  </label>
                  <label className="field field--full">
                    <span>{copy.returnFlow.fields.parkingNote}</span>
                    <textarea className="textarea" rows={3} value={form.parkingNote} onChange={(event) => setForm((current) => ({ ...current, parkingNote: event.target.value }))} />
                  </label>
                </>
              ) : null}
              {form.decision === "hold" ? (
                <>
                  <label className="field field--full">
                    <span>{copy.returnFlow.fields.nextRestartStep}</span>
                    <textarea className="textarea" rows={2} value={form.nextRestartStep} onChange={(event) => {
                      setNextRestartTouched(true);
                      setForm((current) => ({ ...current, nextRestartStep: event.target.value }));
                    }} />
                  </label>
                  <label className="field">
                    <span>{copy.returnFlow.fields.resumeTriggerType}</span>
                    <select className="input" value={form.resumeTriggerType} onChange={(event) => setForm((current) => ({ ...current, resumeTriggerType: event.target.value as ResumeTriggerType }))}>
                      <option value="manual">{getLabel(locale, "manual")}</option>
                      <option value="date">{getLabel(locale, "date")}</option>
                      <option value="condition">{getLabel(locale, "condition")}</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>{copy.returnFlow.fields.resumeTriggerText}</span>
                    <input className="input" value={form.resumeTriggerText} onChange={(event) => setForm((current) => ({ ...current, resumeTriggerText: event.target.value }))} />
                  </label>
                </>
              ) : null}
              <div className="button-row field--full">
                <button className="button button--ghost" onClick={() => setCurrentStep(2)} type="button">
                  {copy.returnFlow.buttons.back}
                </button>
                <button className="button" disabled={isPending || !decisionReady} onClick={handleSave} type="button">
                  {copy.returnFlow.buttons.save}
                </button>
              </div>
            </div>
          ) : null}
        </SectionCard>
      </div>

      {state.latestReturnRun ? (
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.returnFlow.latestTitle}</p>
              <h2>{getLabel(locale, state.latestReturnRun.decision)}</h2>
            </div>
            <StatusPill label={state.latestReturnRun.diagnosisType} />
          </div>
          <p><strong>{copy.returnFlow.labels.next15m}:</strong> {state.latestReturnRun.next15mAction}</p>
          <p><strong>{copy.returnFlow.labels.ifThen}:</strong> {state.latestReturnRun.ifThenPlan || "-"}</p>
        </SectionCard>
      ) : null}
    </div>
  );
}

