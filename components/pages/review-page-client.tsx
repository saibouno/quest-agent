"use client";

import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { StatStrip } from "@/components/shared/stat-strip";
import { StatusPill } from "@/components/shared/status-pill";
import { buildHeuristicReviewFocusReasons, buildReviewFocusCandidates } from "@/lib/quest-agent/derive";
import { getCopy, localizeRuntimeError } from "@/lib/quest-agent/copy";
import type { Goal, LeadMetricsDaily, ReviewFocusCandidateReason } from "@/lib/quest-agent/types";

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
  return locale === "ja" ? `${Math.round(value)}分` : `${Math.round(value)}m`;
}

export function ReviewPageClient() {
  const router = useRouter();
  const { state, aiEnabled, clientStorageMode, createReview, selectFocusGoal, generateReviewFocusReasons } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [focusReasons, setFocusReasons] = useState<ReviewFocusCandidateReason[]>([]);
  const [form, setForm] = useState({
    periodStart: todayOffset(-6),
    periodEnd: todayOffset(0),
    summary: "",
    learnings: "",
    rerouteNote: "",
    nextFocus: "",
  });

  const reviewGoal = state.focusGoal ?? state.activeGoals[0] ?? state.goals.find((goal) => goal.status !== "completed") ?? null;
  const latestLeadMetrics: LeadMetricsDaily | null = state.leadMetricsDaily[0] ?? null;
  const focusCandidates = useMemo(() => buildReviewFocusCandidates(state), [state]);
  const heuristicReasons = useMemo(() => buildHeuristicReviewFocusReasons(focusCandidates, locale), [focusCandidates, locale]);
  const focusReasonMap = useMemo(() => new Map(focusReasons.map((item) => [item.goalId, item])), [focusReasons]);
  const goalMap = useMemo(() => new Map(state.goals.map((goal) => [goal.id, goal])), [state.goals]);

  const stats = useMemo(
    () => [
      { label: copy.review.stats.mainRatio, value: latestLeadMetrics ? formatRatio(latestLeadMetrics.mainWorkRatio) : "-", detail: copy.review.details.mainRatio },
      { label: copy.review.stats.metaRatio, value: latestLeadMetrics ? formatRatio(latestLeadMetrics.metaWorkRatio) : "-", detail: copy.review.details.metaRatio },
      { label: copy.review.stats.startDelay, value: latestLeadMetrics ? formatMinutes(locale, latestLeadMetrics.startDelayMinutes) : "-", detail: copy.review.details.startDelay },
      { label: copy.review.stats.resumeDelay, value: latestLeadMetrics ? formatMinutes(locale, latestLeadMetrics.resumeDelayMinutes) : "-", detail: copy.review.details.resumeDelay },
      { label: copy.review.stats.switchDensity, value: latestLeadMetrics?.switchDensity ?? "-", detail: copy.review.details.switchDensity },
      { label: copy.review.stats.ifThen, value: latestLeadMetrics ? formatRatio(latestLeadMetrics.ifThenCoverage) : "-", detail: copy.review.details.ifThen },
    ],
    [copy, latestLeadMetrics, locale],
  );

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
        <Link className="button" href="/intake?new=1">
          {copy.review.addGoal}
        </Link>
      </SectionCard>
    );
  }

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
          rerouteNote: form.rerouteNote,
          nextFocus: form.nextFocus,
        });
        setMessage(copy.review.messages.saved);
        setForm({ periodStart: todayOffset(-6), periodEnd: todayOffset(0), summary: "", learnings: "", rerouteNote: "", nextFocus: "" });
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, locale === "ja" ? "ふり返りを保存できませんでした。" : "Review save failed."));
      }
    });
  }

  function handleSetCandidate(goalId: string) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await selectFocusGoal({ goalId, reason: locale === "ja" ? "ふり返りで次の本丸を選んだ。" : "Review selected the next focus goal." });
        setMessage(copy.review.messages.focusSaved);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, locale === "ja" ? "本丸を更新できませんでした。" : "Failed to set focus goal from review."));
      }
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">{copy.nav.review}</p>
          <h1>{copy.review.title}</h1>
          <p className="lead">{copy.review.lead}</p>
        </div>
      </section>

      <StatStrip items={stats} />
      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <div className="two-column two-column--wide">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.review.formTitle}</p>
              <h2>{reviewGoal.title}</h2>
            </div>
            <StatusPill label={reviewGoal.status} />
          </div>

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

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.review.dailyLeadTitle}</p>
              <h2>{state.leadMetricsDaily.length ? copy.review.dailyLeadTitle : copy.review.dailyLeadEmpty}</h2>
            </div>
          </div>
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
        </SectionCard>
      </div>

      <div className="two-column two-column--wide">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.review.focusCandidatesTitle}</p>
              <h2>{copy.review.focusCandidatesLead}</h2>
            </div>
          </div>
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
                        <button className="button button--ghost" disabled={isPending} onClick={() => handleSetCandidate(goal.id)} type="button">
                          {copy.review.buttons.setFocus}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">{copy.review.savedReviewsEmpty}</p>
          )}
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.review.savedReviewsTitle}</p>
              <h2>{state.reviews.length ? copy.review.savedReviewsTitle : copy.review.savedReviewsEmpty}</h2>
            </div>
          </div>
          {state.reviews.length ? (
            <div className="stack-lg">
              {state.reviews.map((review) => (
                <div className="milestone-card" key={review.id}>
                  <div className="milestone-card__header">
                    <div>
                      <p className="eyebrow">{review.periodStart} - {review.periodEnd}</p>
                      <h3>{review.summary}</h3>
                    </div>
                    <StatusPill label="completed" />
                  </div>
                  <p><strong>{copy.review.labels.learnings}:</strong> {review.learnings || copy.common.noData}</p>
                  <p><strong>{copy.review.labels.reroute}:</strong> {review.rerouteNote || copy.common.noData}</p>
                  <p><strong>{copy.review.labels.nextFocus}:</strong> {review.nextFocus || copy.common.noData}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{copy.review.savedReviewsEmpty}</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
