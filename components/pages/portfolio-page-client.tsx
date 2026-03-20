"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { DisclosureSection } from "@/components/shared/disclosure-section";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import {
  buildPortfolioMovableGoals,
  buildPortfolioStoppedEntries,
  findLatestArtifactNoteForGoal,
  findLatestDoneWhenForGoal,
} from "@/lib/quest-agent/derive";
import { getCopy, getLabel, interpolate, localizeRuntimeError } from "@/lib/quest-agent/copy";
import type { Goal, ResumeQueueEntry, ResumeTriggerType } from "@/lib/quest-agent/types";

function formatResumeHours(locale: "ja" | "en", value: number | null): string {
  if (value === null) {
    return "-";
  }
  return interpolate(getCopy(locale).common.durationHours, { value: value.toFixed(1) });
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
  const [switchReason, setSwitchReason] = useState<string>(copy.portfolio.defaults.switchReason);
  const [resumeReason, setResumeReason] = useState<string>(copy.portfolio.defaults.resumeReason);
  const [parkingGoalId, setParkingGoalId] = useState<string | null>(null);
  const [parkingForm, setParkingForm] = useState(defaultParkingForm());
  const [expandedGoalIds, setExpandedGoalIds] = useState<string[]>([]);
  const [expandedQueueIds, setExpandedQueueIds] = useState<string[]>([]);

  const movableGoals = useMemo(() => buildPortfolioMovableGoals(state), [state]);
  const stoppedEntries = useMemo(() => buildPortfolioStoppedEntries(state), [state]);
  const manageSummary = movableGoals.length
    ? `${interpolate(copy.common.itemCount, { value: String(movableGoals.length) })} / ${movableGoals[0]?.title ?? copy.common.noData}`
    : copy.portfolio.movableEmpty;
  const settingsSummary = `${copy.portfolio.stats.activeGoals} ${state.portfolioStats.activeGoalCount}/${state.portfolioStats.wipLimit} / ${copy.portfolio.stats.medianResume} ${formatResumeHours(locale, state.switchSummary.medianResumeHours)}`;
  const resumeSummary = stoppedEntries.length
    ? `${interpolate(copy.common.itemCount, { value: String(stoppedEntries.length) })} / ${stoppedEntries[0]?.goal?.title ?? copy.portfolio.queue.missingGoal}`
    : copy.portfolio.stoppedEmpty;

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

  function toggleGoalDetails(goalId: string) {
    setExpandedGoalIds((current) => (current.includes(goalId) ? current.filter((item) => item !== goalId) : [...current, goalId]));
  }

  function toggleQueueDetails(queueId: string) {
    setExpandedQueueIds((current) => (current.includes(queueId) ? current.filter((item) => item !== queueId) : [...current, queueId]));
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
        setError(localizeRuntimeError(locale, nextError, copy.portfolio.errors.limitSave));
      }
    });
  }

  function handleFocus(goalId: string) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await selectFocusGoal({ goalId, reason: switchReason.trim() || copy.portfolio.defaults.focusFallback });
        setMessage(copy.portfolio.messages.focusSaved);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.portfolio.errors.focusSave));
      }
    });
  }

  function handleResume(goalId: string) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await resumeGoal({ goalId, reason: resumeReason.trim() || copy.portfolio.defaults.resumeFallback });
        setMessage(copy.portfolio.messages.resumeSaved);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.portfolio.errors.resumeSave));
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
        setError(localizeRuntimeError(locale, nextError, copy.portfolio.errors.parkSave));
      }
    });
  }

  function renderRestartDetails(item: Pick<ResumeQueueEntry, "reason" | "parkingNote" | "nextRestartStep" | "resumeTriggerType" | "resumeTriggerText" | "isOverdue">) {
    return (
      <div className="stack-md">
        <p><strong>{copy.portfolio.queue.whyStopped}:</strong> {item.reason || copy.common.noData}</p>
        <p><strong>{copy.portfolio.queue.whereStopped}:</strong> {item.parkingNote || copy.common.noData}</p>
        <p><strong>{copy.portfolio.queue.nextRestart}:</strong> {item.nextRestartStep || copy.common.noData}</p>
        <div className="stack-md">
          <div className="pill-row">
            <StatusPill label={item.resumeTriggerType} />
            {item.isOverdue ? <StatusPill label="overdue" /> : null}
          </div>
          <p><strong>{copy.portfolio.queue.trigger}:</strong> {formatResumeTrigger(locale, item.resumeTriggerType, item.resumeTriggerText)}</p>
        </div>
      </div>
    );
  }

  function renderParkingForm(goalId: string) {
    return (
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
            onClick={() => handlePark(goalId)}
            type="button"
          >
            {copy.portfolio.buttons.saveParkingNote}
          </button>
          <button className="button button--ghost" disabled={isPending} onClick={() => setParkingGoalId(null)} type="button">
            {copy.common.cancel}
          </button>
        </div>
      </div>
    );
  }

  function renderMovableGoalCard(goal: Goal) {
    const isExpanded = expandedGoalIds.includes(goal.id) || parkingGoalId === goal.id;
    const canPark = goal.status === "active";

    return (
      <div className="portfolio-card" key={goal.id}>
        <div className="portfolio-card__header">
          <div>
            <div className="pill-row">
              <StatusPill label={goal.status} />
            </div>
            <h3>{goal.title}</h3>
            <p className="muted">{goal.description || goal.currentState || copy.common.noSummary}</p>
          </div>
          <div className="button-row">
            <button className="button" disabled={isPending} onClick={() => handleFocus(goal.id)} type="button">
              {goal.status === "active" ? copy.portfolio.buttons.setFocus : copy.portfolio.buttons.activateAndFocus}
            </button>
            <button className="button button--ghost" onClick={() => toggleGoalDetails(goal.id)} type="button">
              {isExpanded ? copy.common.hideDetails : copy.common.showDetails}
            </button>
          </div>
        </div>

        {isExpanded ? (
          <div className="stack-lg">
            <p>{goal.currentState || goal.description || copy.common.noSummary}</p>
            {canPark && parkingGoalId !== goal.id ? (
              <div className="button-row">
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
              </div>
            ) : null}
            {parkingGoalId === goal.id ? renderParkingForm(goal.id) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderStoppedCard(item: ResumeQueueEntry) {
    const isExpanded = expandedQueueIds.includes(item.id);
    const summary = item.nextRestartStep || item.reason || formatResumeTrigger(locale, item.resumeTriggerType, item.resumeTriggerText);

    return (
      <div className="queue-card" key={item.id}>
        <div className="queue-card__header">
          <div>
            <div className="pill-row">
              <StatusPill label={item.stopMode} />
              <StatusPill label={item.resumeTriggerType} />
              {item.isOverdue ? <StatusPill label="overdue" /> : null}
            </div>
            <h3>{item.goal?.title ?? copy.portfolio.queue.missingGoal}</h3>
            <p className="muted">{summary}</p>
          </div>
          <div className="button-row">
            <button className="button" disabled={isPending} onClick={() => handleResume(item.goalId)} type="button">
              {copy.portfolio.buttons.resumeGoal}
            </button>
            <button className="button button--ghost" onClick={() => toggleQueueDetails(item.id)} type="button">
              {isExpanded ? copy.common.hideDetails : copy.common.showDetails}
            </button>
          </div>
        </div>
        {isExpanded ? renderRestartDetails(item) : null}
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">{copy.nav.portfolio}</p>
          <h1>{copy.portfolio.title}</h1>
          {copy.portfolio.lead ? <p className="lead">{copy.portfolio.lead}</p> : null}
        </div>
      </section>

      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">{copy.portfolio.focusTitle}</p>
            <h2>{state.focusGoal?.title ?? copy.portfolio.focusEmpty}</h2>
            <p className="muted">{state.focusGoal?.currentState || state.focusGoal?.description || copy.portfolio.focusBody}</p>
          </div>
          {state.focusGoal ? <StatusPill label={state.focusGoal.status} /> : null}
        </div>
        <div className="pill-row">
          <span className="pill">{copy.portfolio.stats.activeGoals} {state.portfolioStats.activeGoalCount}/{state.portfolioStats.wipLimit}</span>
          <span className="pill">{copy.portfolio.stats.resumeQueue} {stoppedEntries.length}</span>
        </div>
        <div className="button-row">
          {state.focusGoal ? (
            <>
              <Link className="button" href="/today">
                {copy.common.openToday}
              </Link>
              <Link className="button button--secondary" href="/map">
                {copy.portfolio.buttons.editRoute}
              </Link>
              <Link className="button button--ghost" href="/review">
                {copy.nav.review}
              </Link>
            </>
          ) : movableGoals.length ? (
            <a className="button" href="#portfolio-manage">
              {copy.portfolio.buttons.chooseFromList}
            </a>
          ) : null}
          <Link className="button button--secondary" href="/onboarding/intake">
            {copy.portfolio.addGoal}
          </Link>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">{copy.portfolio.stoppedTitle}</p>
            <h2>{copy.portfolio.stoppedTitle}</h2>
            <p className="muted">{resumeSummary}</p>
          </div>
        </div>
        {stoppedEntries.length ? (
          <div className="stack-lg">{stoppedEntries.map(renderStoppedCard)}</div>
        ) : (
          <p className="muted">{copy.portfolio.stoppedEmpty}</p>
        )}
      </SectionCard>

      <div id="portfolio-manage">
        <DisclosureSection
          eyebrow={copy.portfolio.movableTitle}
          title={copy.portfolio.movableTitle}
          summary={manageSummary}
          initialOpen={false}
          openLabel={copy.common.showDetails}
          closeLabel={copy.common.hideDetails}
          actions={(
            <Link className="button button--secondary" href="/onboarding/intake">
              {copy.portfolio.addGoal}
            </Link>
          )}
        >
          {movableGoals.length ? <div className="stack-lg">{movableGoals.map(renderMovableGoalCard)}</div> : <p className="muted">{copy.portfolio.movableEmpty}</p>}
        </DisclosureSection>
      </div>

      <DisclosureSection
        eyebrow={copy.portfolio.settingsTitle}
        title={copy.portfolio.settingsTitle}
        summary={settingsSummary}
        initialOpen={false}
        openLabel={copy.common.showDetails}
        closeLabel={copy.common.hideDetails}
      >
        <div className="pill-row">
          <span className="pill">{copy.portfolio.stats.switches} {state.switchSummary.switchesThisWeek}</span>
          <span className="pill">{copy.portfolio.stats.reviewRate} {state.switchSummary.reviewCompletionRate}%</span>
          <span className="pill">{copy.portfolio.stats.resumeQueue} {state.portfolioStats.resumeQueueCount}</span>
        </div>
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
          <button className="button button--secondary" disabled={isPending} onClick={handleSaveWip} type="button">
            {copy.portfolio.buttons.saveLimit}
          </button>
        </div>
      </DisclosureSection>
    </div>
  );
}
