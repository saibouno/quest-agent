"use client";

import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { DisclosureSection } from "@/components/shared/disclosure-section";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { buildHeuristicReviewFocusReasons, buildReviewFocusCandidates } from "@/lib/quest-agent/derive";
import { buildReviewLearningBucketMap, getLearningCaptureLabel } from "@/lib/quest-agent/learning-capture";
import { getCopy, interpolate, localizeRuntimeError } from "@/lib/quest-agent/copy";
import { buildReservedRoleTrace, getReservedRoleLabel, summarizeReservedRoleEvent } from "@/lib/quest-agent/role-trace";
import { learningCaptureBuckets } from "@/lib/quest-agent/types";
import type { Goal, LeadMetricsDaily, LearningCaptureBucket, ReviewFocusCandidateReason } from "@/lib/quest-agent/types";

function todayOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatRatio(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMinutes(locale: "ja" | "en", value: number | null) {
  if (value === null) {
    return "-";
  }
  return interpolate(getCopy(locale).common.durationMinutes, { value: String(Math.round(value)) });
}

function getRoleTraceCopy(locale: "ja" | "en") {
  return locale === "ja"
    ? {
        title: "Internal Role Trace",
        empty: "No reserved role events yet.",
      }
    : {
        title: "Internal Role Trace",
        empty: "No reserved role events yet.",
      };
}

function getLearningCaptureCopy(locale: "ja" | "en") {
  return locale === "ja"
    ? {
        field: "学びの分類（任意）",
        label: "分類",
        empty: "分類なし",
      }
    : {
        field: "Learning bucket (optional)",
        label: "Bucket",
        empty: "No bucket",
      };
}

export function ReviewPageClient() {
  const router = useRouter();
  const { state, aiEnabled, clientStorageMode, createReview, selectFocusGoal, generateReviewFocusReasons } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale);
  const roleTraceCopy = getRoleTraceCopy(locale);
  const learningCaptureCopy = getLearningCaptureCopy(locale);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [focusReasons, setFocusReasons] = useState<ReviewFocusCandidateReason[]>([]);
  const [form, setForm] = useState({
    periodStart: todayOffset(-6),
    periodEnd: todayOffset(0),
    summary: "",
    learnings: "",
    learningBucket: "" as LearningCaptureBucket | "",
    rerouteNote: "",
    nextFocus: "",
  });

  const reviewGoal = state.focusGoal ?? state.activeGoals[0] ?? state.goals.find((goal) => goal.status !== "completed") ?? null;
  const latestLeadMetrics: LeadMetricsDaily | null = state.leadMetricsDaily[0] ?? null;
  const focusCandidates = useMemo(() => buildReviewFocusCandidates(state), [state]);
  const heuristicReasons = useMemo(() => buildHeuristicReviewFocusReasons(focusCandidates, locale), [focusCandidates, locale]);
  const focusReasonMap = useMemo(() => new Map(focusReasons.map((item) => [item.goalId, item])), [focusReasons]);
  const goalMap = useMemo(() => new Map(state.goals.map((goal) => [goal.id, goal])), [state.goals]);
  const reviewLearningBucketMap = useMemo(() => buildReviewLearningBucketMap(state.events, reviewGoal.id), [state.events, reviewGoal.id]);
  const timestampFormatter = useMemo(() => new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);

  useEffect(() => {
    setFocusReasons(heuristicReasons);
  }, [heuristicReasons]);

  const refreshFocusReasons = useEffectEvent(async (candidates: typeof focusCandidates) => {
    return generateReviewFocusReasons({
      currentFocusGoalId: state.focusGoal?.id ?? null,
      candidates,
      locale,
    });
  });

  useEffect(() => {
    let cancelled = false;

    if (!focusCandidates.length || !aiEnabled) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const nextReasons = await refreshFocusReasons(focusCandidates);
      if (!cancelled) {
        setFocusReasons(nextReasons);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [aiEnabled, focusCandidates, locale, state.focusGoal?.id]);

  if (!reviewGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">{copy.nav.review}</p>
        <h1>{copy.review.noGoalTitle}</h1>
        <Link className="button" href="/onboarding/intake">
          {copy.review.addGoal}
        </Link>
      </SectionCard>
    );
  }

  const leadSummary = latestLeadMetrics
    ? `${copy.review.stats.mainRatio} ${formatRatio(latestLeadMetrics.mainWorkRatio)} ・ ${copy.review.stats.startDelay} ${formatMinutes(locale, latestLeadMetrics.startDelayMinutes)} ・ ${copy.review.stats.switchDensity} ${latestLeadMetrics.switchDensity}`
    : copy.review.dailyLeadEmpty;
  const topCandidate = focusCandidates[0] ? goalMap.get(focusCandidates[0].goalId) : null;
  const topCandidateReason = focusCandidates[0] ? focusReasonMap.get(focusCandidates[0].goalId) ?? heuristicReasons.find((item) => item.goalId === focusCandidates[0].goalId) : null;
  const candidateSummary = topCandidate ? `${topCandidate.title} ・ ${topCandidateReason?.reason ?? copy.review.candidateReason}`  : copy.review.focusCandidatesEmpty;
  const reviewsSummary = state.reviews.length ? interpolate(copy.common.itemCount, { value: String(state.reviews.length) }) : copy.review.savedReviewsEmpty;
  const reservedRoleTrace = buildReservedRoleTrace(state.events, reviewGoal.id).slice(0, 6);
  const reservedRoleSummary = reservedRoleTrace[0]
    ? `${getReservedRoleLabel(reservedRoleTrace[0].type)} / ${summarizeReservedRoleEvent(reservedRoleTrace[0], locale)}`
    : roleTraceCopy.empty;

  function refreshIfNeeded() {
    if (clientStorageMode === "server-backed") {
      router.refresh();
    }
  }

  function updateField(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleSave() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await createReview({
          goalId: reviewGoal.id,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          summary: form.summary,
          learnings: form.learnings,
          learningBucket: form.learningBucket || null,
          rerouteNote: form.rerouteNote,
          nextFocus: form.nextFocus,
        });
        setMessage(copy.review.messages.saved);
        setForm({ periodStart: todayOffset(-6), periodEnd: todayOffset(0), summary: "", learnings: "", learningBucket: "", rerouteNote: "", nextFocus: "" });
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.review.errors.save));
      }
    });
  }

  function handleSetCandidate(goalId: string) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await selectFocusGoal({ goalId, reason: copy.review.messages.focusReason });
        setMessage(copy.review.messages.focusSaved);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.review.errors.focusSave));
      }
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">{copy.nav.review}</p>
          <h1>{copy.review.title}</h1>
          {copy.review.lead ? <p className="lead">{copy.review.lead}</p> : null}
        </div>
      </section>

      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">{copy.review.formTitle}</p>
            <h2>{reviewGoal.title}</h2>
          </div>
          <StatusPill label={reviewGoal.status} />
        </div>
        {latestLeadMetrics ? (
          <div className="pill-row">
            <span className="pill">{copy.review.stats.mainRatio} {formatRatio(latestLeadMetrics.mainWorkRatio)}</span>
            <span className="pill">{copy.review.stats.startDelay} {formatMinutes(locale, latestLeadMetrics.startDelayMinutes)}</span>
            <span className="pill">{copy.review.stats.switchDensity} {latestLeadMetrics.switchDensity}</span>
          </div>
        ) : null}
        <div className="form-grid">
          <label className="field">
            <span>{copy.review.fields.periodStart}</span>
            <input className="input" type="date" value={form.periodStart} onChange={(event) => updateField("periodStart", event.target.value)} />
          </label>
          <label className="field">
            <span>{copy.review.fields.periodEnd}</span>
            <input className="input" type="date" value={form.periodEnd} onChange={(event) => updateField("periodEnd", event.target.value)} />
          </label>
          <label className="field field--full">
            <span>{copy.review.fields.summary}</span>
            <textarea className="textarea" rows={4} value={form.summary} onChange={(event) => updateField("summary", event.target.value)} />
          </label>
          <label className="field field--full">
            <span>{copy.review.fields.learnings}</span>
            <textarea className="textarea" rows={3} value={form.learnings} onChange={(event) => updateField("learnings", event.target.value)} />
          </label>
          <label className="field">
            <span>{learningCaptureCopy.field}</span>
            <select className="input" value={form.learningBucket} onChange={(event) => updateField("learningBucket", event.target.value)}>
              <option value="">{learningCaptureCopy.empty}</option>
              {learningCaptureBuckets.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {getLearningCaptureLabel(bucket, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--full">
            <span>{copy.review.fields.rerouteNote}</span>
            <textarea className="textarea" rows={3} value={form.rerouteNote} onChange={(event) => updateField("rerouteNote", event.target.value)} />
          </label>
          <label className="field field--full">
            <span>{copy.review.fields.nextFocus}</span>
            <textarea className="textarea" rows={3} value={form.nextFocus} onChange={(event) => updateField("nextFocus", event.target.value)} />
          </label>
        </div>
        <div className="button-row">
          <button className="button" disabled={isPending || !form.summary.trim()} onClick={handleSave} type="button">
            {copy.review.buttons.saveReview}
          </button>
        </div>
      </SectionCard>

      <DisclosureSection
        eyebrow={copy.review.dailyLeadTitle}
        title={copy.review.dailyLeadTitle}
        summary={leadSummary}
        initialOpen={false}
        openLabel={copy.common.showDetails}
        closeLabel={copy.common.hideDetails}
      >
        {state.leadMetricsDaily.length ? (
          <div className="stack-lg">
            {state.leadMetricsDaily.slice(0, 7).map((metrics) => (
              <div className="queue-card" key={metrics.dayKey}>
                <div className="queue-card__header">
                  <div>
                    <div className="pill-row">
                      <StatusPill label={metrics.monitoringDone ? "active" : "planned"} />
                    </div>
                    <h3>{metrics.dayKey}</h3>
                    <p className="muted">{copy.review.stats.mainRatio} {formatRatio(metrics.mainWorkRatio)} / {copy.review.stats.metaRatio} {formatRatio(metrics.metaWorkRatio)}</p>
                  </div>
                </div>
                <p><strong>{copy.review.labels.startDelay}:</strong> {formatMinutes(locale, metrics.startDelayMinutes)}</p>
                <p><strong>{copy.review.labels.resumeDelay}:</strong> {formatMinutes(locale, metrics.resumeDelayMinutes)}</p>
                <p><strong>{copy.review.labels.switchDensity}:</strong> {metrics.switchDensity}</p>
                <p><strong>{copy.review.labels.ifThenCoverage}:</strong> {formatRatio(metrics.ifThenCoverage)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{copy.review.dailyLeadEmpty}</p>
        )}
      </DisclosureSection>

      <DisclosureSection
        eyebrow={copy.review.focusCandidatesTitle}
        title={copy.review.focusCandidatesTitle}
        summary={candidateSummary}
        initialOpen={false}
        openLabel={copy.common.showDetails}
        closeLabel={copy.common.hideDetails}
      >
        {focusCandidates.length ? (
          <div className="stack-lg">
            {focusCandidates.map((candidate) => {
              const goal = goalMap.get(candidate.goalId) as Goal;
              const reason = focusReasonMap.get(candidate.goalId) ?? heuristicReasons.find((item) => item.goalId === candidate.goalId);
              return (
                <div className="portfolio-card" key={candidate.goalId}>
                  <div className="portfolio-card__header">
                    <div>
                      <div className="pill-row">
                        <StatusPill label={goal.status} />
                        {goal.id === state.focusGoal?.id ? <StatusPill label="active" /> : null}
                        {reason ? <StatusPill label={reason.mode} /> : null}
                      </div>
                      <h3>{goal.title}</h3>
                      <p className="muted">{goal.description || goal.currentState || copy.common.noSummary}</p>
                      <p className="muted">{reason?.reason || copy.review.candidateReason}</p>
                    </div>
                    {goal.id !== state.focusGoal?.id ? (
                      <button className="button button--secondary" disabled={isPending} onClick={() => handleSetCandidate(goal.id)} type="button">
                        {copy.review.buttons.setFocus}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">{copy.review.focusCandidatesEmpty}</p>
        )}
      </DisclosureSection>

      <DisclosureSection
        eyebrow={copy.review.savedReviewsTitle}
        title={copy.review.savedReviewsTitle}
        summary={reviewsSummary}
        initialOpen={false}
        openLabel={copy.common.showDetails}
        closeLabel={copy.common.hideDetails}
      >
        {state.reviews.length ? (
          <div className="stack-lg">
            {state.reviews.map((review) => {
              const learningBucket = reviewLearningBucketMap.get(review.id);
              return (
              <div className="milestone-card" key={review.id}>
                <div className="milestone-card__header">
                  <div>
                    <div className="pill-row">
                      {learningBucket ? <span className="pill">{getLearningCaptureLabel(learningBucket, locale)}</span> : null}
                    </div>
                    <p className="eyebrow">{review.periodStart} - {review.periodEnd}</p>
                    <h3>{review.summary}</h3>
                  </div>
                  <StatusPill label="completed" />
                </div>
                <p><strong>{learningCaptureCopy.label}:</strong> {learningBucket ? getLearningCaptureLabel(learningBucket, locale) : learningCaptureCopy.empty}</p>
                <p><strong>{copy.review.labels.learnings}:</strong> {review.learnings || copy.common.noData}</p>
                <p><strong>{copy.review.labels.reroute}:</strong> {review.rerouteNote || copy.common.noData}</p>
                <p><strong>{copy.review.labels.nextFocus}:</strong> {review.nextFocus || copy.common.noData}</p>
              </div>
            );})}
          </div>
        ) : (
          <p className="muted">{copy.review.savedReviewsEmpty}</p>
        )}
      </DisclosureSection>

      <DisclosureSection
        eyebrow={roleTraceCopy.title}
        title={roleTraceCopy.title}
        summary={reservedRoleSummary}
        initialOpen={false}
        openLabel={copy.common.showDetails}
        closeLabel={copy.common.hideDetails}
      >
        {reservedRoleTrace.length ? (
          <div className="stack-lg">
            {reservedRoleTrace.map((event) => (
              <div className="queue-card" key={`${event.type}:${event.createdAt}`}>
                <div className="queue-card__header">
                  <div>
                    <div className="pill-row">
                      <span className="pill">{getReservedRoleLabel(event.type)}</span>
                    </div>
                    <h3>{summarizeReservedRoleEvent(event, locale)}</h3>
                    <p className="muted">{timestampFormatter.format(new Date(event.createdAt))}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{roleTraceCopy.empty}</p>
        )}
      </DisclosureSection>
    </div>
  );
}
