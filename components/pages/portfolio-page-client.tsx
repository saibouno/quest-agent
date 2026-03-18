"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { StatStrip } from "@/components/shared/stat-strip";
import { StatusPill } from "@/components/shared/status-pill";
import { findLatestArtifactNoteForGoal, findLatestDoneWhenForGoal } from "@/lib/quest-agent/derive";
import { getCopy, getLabel, interpolate, localizeRuntimeError } from "@/lib/quest-agent/copy";
import type { Goal, ResumeQueueEntry, ResumeTriggerType } from "@/lib/quest-agent/types";

function formatResumeHours(locale: "ja" | "en", value: number | null): string {
  if (value === null) {
    return "-";
  }
  return locale === "ja" ? `${value.toFixed(1)}時間` : `${value.toFixed(1)}h`;
}

function formatResumeTrigger(locale: "ja" | "en", triggerType: ResumeTriggerType, value: string): string {
  if (triggerType === "date") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", { dateStyle: "medium" }).format(new Date(parsed));
    }
  }
  return value || "-";
}

function defaultParkingForm(parkingNote = "", nextRestartStep = "") {
  return {
    stopMode: "hold",
    reason: "",
    parkingNote,
    nextRestartStep,
    resumeTriggerType: "manual",
    resumeTriggerText: "",
  };
}

export function PortfolioPageClient() {
  const router = useRouter();
  const { state, clientStorageMode, updatePortfolioSettings, selectFocusGoal, parkGoal, resumeGoal } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [wipLimit, setWipLimit] = useState(String(state.portfolioSettings.wipLimit));
  const [switchReason, setSwitchReason] = useState(locale === "ja" ? "今週はいちばんこれを前に置きたいから。" : "This deserves the front slot this week.");
  const [resumeReason, setResumeReason] = useState(locale === "ja" ? "再開条件がそろったから。" : "The restart trigger is now clear.");
  const [parkingGoalId, setParkingGoalId] = useState<string | null>(null);
  const [parkingForm, setParkingForm] = useState(defaultParkingForm());

  const runnableGoals = useMemo(
    () => state.goals.filter((goal) => goal.status !== "completed"),
    [state.goals],
  );
  const queuedGoalIds = useMemo(() => new Set(state.resumeQueue.map((item) => item.goalId)), [state.resumeQueue]);
  const backlogGoals = useMemo(
    () => runnableGoals.filter((goal) => goal.status !== "active" && !queuedGoalIds.has(goal.id)),
    [queuedGoalIds, runnableGoals],
  );
  const parkedLookup = useMemo(
    () => new Map(state.resumeQueue.map((item) => [item.goalId, item])),
    [state.resumeQueue],
  );

  const stats = useMemo(
    () => [
      { label: copy.portfolio.stats.focusGoal, value: state.focusGoal ? 1 : 0, detail: state.focusGoal?.title ?? copy.portfolio.focusEmpty },
      { label: copy.portfolio.stats.activeGoals, value: `${state.portfolioStats.activeGoalCount}/${state.portfolioStats.wipLimit}`, detail: copy.portfolio.details.currentActiveCount },
      { label: copy.portfolio.stats.resumeQueue, value: state.portfolioStats.resumeQueueCount, detail: copy.portfolio.details.resumeQueue },
      { label: copy.portfolio.stats.switches, value: state.switchSummary.switchesThisWeek, detail: copy.portfolio.details.recordedThisWeek },
      { label: copy.portfolio.stats.medianResume, value: formatResumeHours(locale, state.switchSummary.medianResumeHours), detail: copy.portfolio.details.restartDelay },
      { label: copy.portfolio.stats.reviewRate, value: `${state.switchSummary.reviewCompletionRate}%`, detail: copy.portfolio.details.last4Weeks },
    ],
    [copy, locale, state],
  );

  function refreshIfNeeded() {
    if (clientStorageMode === "server-backed") {
      router.refresh();
    }
  }

  function buildParkingDefaults(goalId: string) {
    return defaultParkingForm(
      findLatestArtifactNoteForGoal(state.workSessions, goalId),
      findLatestDoneWhenForGoal(state.buildImproveDecisions, goalId),
    );
  }

  function handleSaveWip() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await updatePortfolioSettings({ wipLimit: Number(wipLimit) });
        setMessage(copy.portfolio.messages.limitSaved);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, locale === "ja" ? "同時進行数を更新できませんでした。" : "Failed to update active goal limit."));
      }
    });
  }

  function handleFocus(goalId: string) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await selectFocusGoal({ goalId, reason: switchReason.trim() || (locale === "ja" ? "今はこれがいちばん重要だから。" : "This goal now matters most.") });
        setMessage(copy.portfolio.messages.focusSaved);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, locale === "ja" ? "本丸を切り替えられませんでした。" : "Failed to change focus goal."));
      }
    });
  }

  function handleResume(goalId: string) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await resumeGoal({ goalId, reason: resumeReason.trim() || (locale === "ja" ? "再開条件がそろったから。" : "The restart trigger is now clear.") });
        setMessage(copy.portfolio.messages.resumeSaved);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, locale === "ja" ? "再開できませんでした。" : "Failed to resume goal."));
      }
    });
  }

  function handlePark(goalId: string) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await parkGoal({
          goalId,
          stopMode: parkingForm.stopMode as "hold" | "shrink" | "cancel",
          reason: parkingForm.reason,
          parkingNote: parkingForm.parkingNote,
          nextRestartStep: parkingForm.nextRestartStep,
          resumeTriggerType: parkingForm.resumeTriggerType as ResumeTriggerType,
          resumeTriggerText: parkingForm.resumeTriggerText,
        });
        setParkingGoalId(null);
        setParkingForm(defaultParkingForm());
        setMessage(copy.portfolio.messages.parkedSaved);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, locale === "ja" ? "保留にできませんでした。" : "Failed to park goal."));
      }
    });
  }

  function renderRestartDetails(item: Pick<ResumeQueueEntry, "reason" | "parkingNote" | "nextRestartStep" | "resumeTriggerType" | "resumeTriggerText" | "isOverdue">) {
    return (
      <div className="stack-md">
        <p><strong>{copy.portfolio.queue.whyStopped}:</strong> {item.reason || copy.common.noData}</p>
        <p><strong>{copy.portfolio.fields.parkingNote}:</strong> {item.parkingNote || copy.common.noData}</p>
        <p><strong>{copy.portfolio.queue.nextRestart}:</strong> {item.nextRestartStep || copy.common.noData}</p>
        <div className="stack-md">
          <div className="pill-row">
            <StatusPill label={item.resumeTriggerType} />
            {item.isOverdue ? <StatusPill label="blocked" /> : null}
          </div>
          <p><strong>{copy.portfolio.queue.trigger}:</strong> {formatResumeTrigger(locale, item.resumeTriggerType, item.resumeTriggerText)}</p>
        </div>
      </div>
    );
  }

  function renderGoalCard(goal: Goal) {
    const queueItem = parkedLookup.get(goal.id);
    const isFocus = state.focusGoal?.id === goal.id;
    return (
      <div className="portfolio-card" key={goal.id}>
        <div className="portfolio-card__header">
          <div>
            <div className="pill-row">
              {isFocus ? <StatusPill label="active" /> : null}
              <StatusPill label={goal.status} />
              {queueItem ? <StatusPill label={queueItem.stopMode} /> : null}
            </div>
            <h3>{goal.title}</h3>
            <p className="muted">{goal.description || goal.currentState || copy.common.noSummary}</p>
          </div>
          <div className="button-row">
            {!isFocus ? (
              <button className="button button--ghost" disabled={isPending} onClick={() => handleFocus(goal.id)} type="button">
                {goal.status === "active" ? copy.portfolio.buttons.setFocus : copy.portfolio.buttons.activateAndFocus}
              </button>
            ) : (
              <Link className="button button--ghost" href="/today">
                {copy.common.openToday}
              </Link>
            )}
            {!queueItem ? (
              <button
                className="button button--secondary"
                disabled={isPending}
                onClick={() => {
                  setParkingGoalId(goal.id);
                  setParkingForm(buildParkingDefaults(goal.id));
                }}
                type="button"
              >
                {copy.portfolio.buttons.parkGoal}
              </button>
            ) : (
              <button className="button" disabled={isPending} onClick={() => handleResume(goal.id)} type="button">
                {copy.portfolio.buttons.resumeGoal}
              </button>
            )}
          </div>
        </div>

        {queueItem ? renderRestartDetails(queueItem) : null}

        {parkingGoalId === goal.id ? (
          <div className="form-grid portfolio-form-grid">
            <label className="field">
              <span>{copy.portfolio.fields.stopMode}</span>
              <select className="input" value={parkingForm.stopMode} onChange={(event) => setParkingForm((current) => ({ ...current, stopMode: event.target.value }))}>
                <option value="hold">{getLabel(locale, "hold")}</option>
                <option value="shrink">{getLabel(locale, "shrink")}</option>
                <option value="cancel">{getLabel(locale, "cancel")}</option>
              </select>
            </label>
            <label className="field">
              <span>{copy.portfolio.fields.resumeTrigger}</span>
              <select className="input" value={parkingForm.resumeTriggerType} onChange={(event) => setParkingForm((current) => ({ ...current, resumeTriggerType: event.target.value }))}>
                <option value="manual">{getLabel(locale, "manual")}</option>
                <option value="date">{getLabel(locale, "date")}</option>
                <option value="condition">{getLabel(locale, "condition")}</option>
              </select>
            </label>
            <label className="field field--full">
              <span>{copy.portfolio.fields.whyStopNow}</span>
              <textarea className="textarea" rows={2} value={parkingForm.reason} onChange={(event) => setParkingForm((current) => ({ ...current, reason: event.target.value }))} />
            </label>
            <label className="field field--full">
              <span>{copy.portfolio.fields.parkingNote}</span>
              <textarea className="textarea" rows={3} value={parkingForm.parkingNote} onChange={(event) => setParkingForm((current) => ({ ...current, parkingNote: event.target.value }))} placeholder={copy.portfolio.fields.parkingNotePlaceholder} />
            </label>
            <label className="field field--full">
              <span>{copy.portfolio.fields.nextRestartStep}</span>
              <textarea className="textarea" rows={2} value={parkingForm.nextRestartStep} onChange={(event) => setParkingForm((current) => ({ ...current, nextRestartStep: event.target.value }))} />
            </label>
            <label className="field field--full">
              <span>{copy.portfolio.fields.triggerDetail}</span>
              <textarea className="textarea" rows={2} value={parkingForm.resumeTriggerText} onChange={(event) => setParkingForm((current) => ({ ...current, resumeTriggerText: event.target.value }))} placeholder={copy.portfolio.fields.triggerPlaceholder} />
            </label>
            <div className="button-row field--full">
              <button
                className="button"
                disabled={
                  isPending ||
                  !parkingForm.reason.trim() ||
                  !parkingForm.parkingNote.trim() ||
                  !parkingForm.nextRestartStep.trim() ||
                  !parkingForm.resumeTriggerText.trim()
                }
                onClick={() => handlePark(goal.id)}
                type="button"
              >
                {copy.portfolio.buttons.saveParkingNote}
              </button>
              <button className="button button--ghost" disabled={isPending} onClick={() => setParkingGoalId(null)} type="button">
                {copy.common.cancel}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderQueueCard(item: ResumeQueueEntry) {
    return (
      <div className="queue-card" key={item.id}>
        <div className="queue-card__header">
          <div>
            <div className="pill-row">
              <StatusPill label={item.stopMode} />
              <StatusPill label={item.resumeTriggerType} />
              {item.isOverdue ? <StatusPill label="blocked" /> : null}
            </div>
            <h3>{item.goal?.title ?? copy.portfolio.queue.missingGoal}</h3>
            <p className="muted">{interpolate(copy.portfolio.queue.parkedAgo, { days: item.parkedDays })}</p>
          </div>
          <button className="button" disabled={isPending} onClick={() => handleResume(item.goalId)} type="button">
            {copy.portfolio.buttons.resumeGoal}
          </button>
        </div>
        {renderRestartDetails(item)}
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">{copy.nav.portfolio}</p>
          <h1>{copy.portfolio.title}</h1>
          <p className="lead">{copy.portfolio.lead}</p>
        </div>
        <div className="hero-panel__actions">
          <Link className="button" href="/intake?new=1">
            {copy.portfolio.addGoal}
          </Link>
          <Link className="button button--secondary" href="/today">
            {copy.common.openToday}
          </Link>
        </div>
      </section>

      <StatStrip items={stats} />
      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <div className="two-column two-column--wide">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.portfolio.focusTitle}</p>
              <h2>{state.focusGoal?.title ?? copy.portfolio.focusEmpty}</h2>
            </div>
            {state.focusGoal ? <StatusPill label={state.focusGoal.status} /> : null}
          </div>
          <div className="stack-lg">
            <p>{state.focusGoal?.description || copy.portfolio.focusBody}</p>
            <div className="form-grid portfolio-form-grid">
              <label className="field">
                <span>{copy.portfolio.fields.activeGoalLimit}</span>
                <select className="input" value={wipLimit} onChange={(event) => setWipLimit(event.target.value)}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
              <label className="field field--full">
                <span>{copy.portfolio.fields.switchReason}</span>
                <textarea className="textarea" rows={2} value={switchReason} onChange={(event) => setSwitchReason(event.target.value)} placeholder={copy.portfolio.fields.switchReasonPlaceholder} />
              </label>
              <label className="field field--full">
                <span>{copy.portfolio.fields.resumeReason}</span>
                <textarea className="textarea" rows={2} value={resumeReason} onChange={(event) => setResumeReason(event.target.value)} placeholder={copy.portfolio.fields.resumeReasonPlaceholder} />
              </label>
            </div>
            <div className="button-row">
              <button className="button" disabled={isPending} onClick={handleSaveWip} type="button">
                {copy.portfolio.buttons.saveLimit}
              </button>
              <Link className="button button--ghost" href={state.focusGoal ? "/map" : "/intake"}>
                {state.focusGoal ? copy.portfolio.buttons.editRoute : copy.portfolio.buttons.startIntake}
              </Link>
            </div>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.portfolio.activeTitle}</p>
              <h2>{state.activeGoals.length ? copy.portfolio.activeTitle : copy.portfolio.activeEmpty}</h2>
            </div>
          </div>
          {state.activeGoals.length ? <div className="stack-lg">{state.activeGoals.map(renderGoalCard)}</div> : <p className="muted">{copy.portfolio.activeEmpty}</p>}
        </SectionCard>
      </div>

      <div className="two-column two-column--wide">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.portfolio.backlogTitle}</p>
              <h2>{backlogGoals.length ? copy.portfolio.backlogTitle : copy.portfolio.backlogEmpty}</h2>
            </div>
          </div>
          {backlogGoals.length ? <div className="stack-lg">{backlogGoals.map(renderGoalCard)}</div> : <p className="muted">{copy.portfolio.backlogEmpty}</p>}
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.portfolio.parkedTitle}</p>
              <h2>{state.parkedGoals.length ? copy.portfolio.parkedTitle : copy.portfolio.parkedEmpty}</h2>
            </div>
          </div>
          {state.parkedGoals.length ? (
            <div className="stack-lg">
              {state.parkedGoals.map((goal) => {
                const queueItem = parkedLookup.get(goal.id);
                return (
                  <div className="portfolio-card" key={goal.id}>
                    <div className="portfolio-card__header">
                      <div>
                        <div className="pill-row">
                          <StatusPill label={goal.status} />
                          {queueItem ? <StatusPill label={queueItem.stopMode} /> : null}
                          {queueItem ? <StatusPill label={queueItem.resumeTriggerType} /> : null}
                          {queueItem?.isOverdue ? <StatusPill label="blocked" /> : null}
                        </div>
                        <h3>{goal.title}</h3>
                        <p className="muted">{queueItem?.reason || goal.description || copy.common.noSummary}</p>
                      </div>
                      <button className="button" disabled={isPending} onClick={() => handleResume(goal.id)} type="button">
                        {copy.portfolio.buttons.resumeGoal}
                      </button>
                    </div>
                    {queueItem ? renderRestartDetails(queueItem) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">{copy.portfolio.parkedEmpty}</p>
          )}
        </SectionCard>
      </div>

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">{copy.portfolio.resumeQueueTitle}</p>
            <h2>{state.resumeQueue.length ? copy.portfolio.resumeQueueTitle : copy.portfolio.resumeQueueEmpty}</h2>
          </div>
        </div>
        {state.resumeQueue.length ? <div className="stack-lg">{state.resumeQueue.map(renderQueueCard)}</div> : <p className="muted">{copy.portfolio.resumeQueueEmpty}</p>}
      </SectionCard>
    </div>
  );
}
