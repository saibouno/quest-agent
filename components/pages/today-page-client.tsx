"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { DisclosureSection } from "@/components/shared/disclosure-section";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { getCopy, getLabel, interpolate, localizeRuntimeError } from "@/lib/quest-agent/copy";
import type { Blocker, BuildImproveDecision, TodayPlan } from "@/lib/quest-agent/types";

function defaultSessionForm(questId: string) {
  return {
    category: "main",
    questId,
    mainConnection: "direct",
    artifactCommitment: "",
    timeboxMinutes: 25,
    doneWhen: "",
  };
}

export function TodayPageClient() {
  const router = useRouter();
  const {
    state,
    aiEnabled,
    clientStorageMode,
    planToday,
    createBlocker,
    buildImproveCheck,
    startWorkSession,
    finishWorkSession,
  } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [todayPlan, setTodayPlan] = useState<TodayPlan | null>(null);
  const [latestBlocker, setLatestBlocker] = useState<Blocker | null>(state.currentBlockers[0] ?? null);
  const [sessionForm, setSessionForm] = useState(defaultSessionForm(state.currentQuests[0]?.id ?? ""));
  const [pendingGateDecision, setPendingGateDecision] = useState<BuildImproveDecision | null>(null);
  const [finishArtifactNote, setFinishArtifactNote] = useState("");
  const [blockerForm, setBlockerForm] = useState({
    title: "",
    description: "",
    blockerType: "unknown",
    severity: "medium",
    relatedQuestId: state.currentQuests[0]?.id ?? "",
  });

  const decisionMap = useMemo(() => new Map(state.buildImproveDecisions.map((decision) => [decision.id, decision])), [state.buildImproveDecisions]);
  const activeDecision = state.currentWorkSession?.gateDecisionId ? decisionMap.get(state.currentWorkSession.gateDecisionId) ?? null : null;

  if (!state.focusGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">{copy.nav.today}</p>
        <h1>{copy.today.noFocusTitle}</h1>
        <p className="muted">{copy.today.noFocusBody}</p>
        <Link className="button" href="/portfolio">
          {copy.common.openPortfolio}
        </Link>
      </SectionCard>
    );
  }

  if (!state.currentQuests.length) {
    return (
      <SectionCard>
        <p className="eyebrow">{copy.nav.today}</p>
        <h1>{copy.today.noRouteTitle}</h1>
        <p className="muted">{copy.today.noRouteBody}</p>
        <Link className="button" href="/map">
          {copy.common.openMap}
        </Link>
      </SectionCard>
    );
  }

  const plan = todayPlan ?? {
    theme: copy.today.fallbackTheme,
    quests: state.todaySuggestions,
    notes: [
      state.focusGoal.todayCapacity
        ? interpolate(copy.today.fallbackNotes.capacity, { value: state.focusGoal.todayCapacity })
        : copy.today.fallbackNotes.noCapacity,
      state.currentWorkSession
        ? copy.today.fallbackNotes.hasSession
        : copy.today.fallbackNotes.needsSessionStart,
    ],
    mode: "heuristic" as const,
  };

  const primaryPlanQuest = plan.quests[0] ?? null;
  const remainingPlanCount = Math.max(plan.quests.length - 1, 0);
  const latestSession = state.todayWorkSessions[0] ?? null;
  const latestSessionDecision = latestSession?.gateDecisionId ? decisionMap.get(latestSession.gateDecisionId) : null;
  const sessionSummary = state.todayWorkSessions.length
    ? `${interpolate(copy.common.itemCount, { value: String(state.todayWorkSessions.length) })}${latestSessionDecision?.artifactCommitment ? ` ・ ${latestSessionDecision.artifactCommitment}` : ""}`
    : copy.today.sessionsEmpty;
  const planSummary = primaryPlanQuest
    ? `${primaryPlanQuest.title} ・ ${primaryPlanQuest.focusMinutes}${copy.common.minutes}${remainingPlanCount ? ` ・ +${remainingPlanCount}` : ""}`
    : copy.common.noData;
  const blockerSummary = latestBlocker?.title ?? copy.today.blockerLead;

  function refreshIfNeeded() {
    if (clientStorageMode === "server-backed") {
      router.refresh();
    }
  }

  function resetSessionForm() {
    setSessionForm(defaultSessionForm(state.currentQuests[0]?.id ?? ""));
    setPendingGateDecision(null);
  }

  function handleReplan() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const nextPlan = await planToday({ goalId: state.focusGoal?.id });
        setTodayPlan(nextPlan);
        setMessage(nextPlan.mode === "ai" ? copy.today.messages.planAi : copy.today.messages.planHeuristic);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.today.errors.replan));
      }
    });
  }

  function confirmSessionStart(decision: BuildImproveDecision) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await startWorkSession({
          goalId: state.focusGoal!.id,
          questId: sessionForm.questId || null,
          category: sessionForm.category as "main" | "improve" | "admin" | "other",
          gateDecisionId: decision.id,
        });
        setMessage(decision.mode === "avoidant" ? copy.today.messages.sessionStartedAvoidant : copy.today.messages.sessionStartedBuild);
        resetSessionForm();
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.today.errors.startSession));
      }
    });
  }

  function handleSessionGate() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const decision = await buildImproveCheck({
          goalId: state.focusGoal!.id,
          questId: sessionForm.questId || null,
          category: sessionForm.category as "main" | "improve" | "admin" | "other",
          mainConnection: (sessionForm.category === "main" ? "direct" : sessionForm.mainConnection) as "direct" | "supporting" | "unclear",
          artifactCommitment: sessionForm.artifactCommitment,
          timeboxMinutes: Number(sessionForm.timeboxMinutes),
          doneWhen: sessionForm.doneWhen,
        });

        if (sessionForm.category === "improve" || sessionForm.category === "other") {
          setPendingGateDecision(decision);
          setMessage(decision.mode === "avoidant" ? copy.today.messages.gateRisk : copy.today.messages.gateClear);
          return;
        }

        await startWorkSession({
          goalId: state.focusGoal!.id,
          questId: sessionForm.questId || null,
          category: sessionForm.category as "main" | "improve" | "admin" | "other",
          gateDecisionId: decision.id,
        });
        setMessage(decision.mode === "avoidant" ? copy.today.messages.sessionStartedAvoidant : copy.today.messages.sessionStartedBuild);
        resetSessionForm();
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.today.errors.gate));
      }
    });
  }

  function handleFinishSession() {
    if (!state.currentWorkSession) {
      return;
    }

    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await finishWorkSession({
          sessionId: state.currentWorkSession!.id,
          artifactNote: finishArtifactNote,
        });
        setFinishArtifactNote("");
        setMessage(copy.today.messages.sessionFinished);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.today.errors.finishSession));
      }
    });
  }

  function handleCreateBlocker() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const result = await createBlocker({
          goalId: state.focusGoal!.id,
          relatedQuestId: blockerForm.relatedQuestId || null,
          title: blockerForm.title,
          description: blockerForm.description,
          blockerType: blockerForm.blockerType as Blocker["blockerType"],
          severity: blockerForm.severity as Blocker["severity"],
          status: "open",
        });
        setLatestBlocker(result.blocker);
        setBlockerForm({
          title: "",
          description: "",
          blockerType: "unknown",
          severity: "medium",
          relatedQuestId: state.currentQuests[0]?.id ?? "",
        });
        setMessage(copy.today.messages.blockerSaved);
        refreshIfNeeded();
      } catch (nextError) {
        setError(localizeRuntimeError(locale, nextError, copy.today.errors.blockerSave));
      }
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">{copy.nav.today}</p>
          <h1>{copy.today.title}</h1>
          <p className="lead">{copy.today.lead}</p>
        </div>
      </section>

      {state.mirrorCard.needsReturn ? <p className="feedback feedback--ok">{copy.today.openReturnHint}</p> : null}
      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      {state.currentWorkSession ? (
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.today.activeSessionTitle}</p>
              <h2>{activeDecision?.artifactCommitment || state.focusGoal.title}</h2>
              <p className="muted">{copy.today.labels.doneWhen}: {activeDecision?.doneWhen || copy.common.noData}</p>
            </div>
            <StatusPill label={state.currentWorkSession.category} />
          </div>
          <div className="stack-lg">
            <div className="pill-row">
              <span className="pill">{state.currentWorkSession.plannedMinutes} {copy.common.minutes}</span>
              {activeDecision ? <StatusPill label={activeDecision.mode} /> : null}
            </div>
            <label className="field field--full">
              <span>{copy.today.fields.artifactLeft}</span>
              <textarea className="textarea" rows={2} value={finishArtifactNote} onChange={(event) => setFinishArtifactNote(event.target.value)} placeholder={copy.today.fields.artifactLeftPlaceholder} />
            </label>
            <div className="button-row">
              <button className="button" disabled={isPending} onClick={handleFinishSession} type="button">
                {copy.today.buttons.finishSession}
              </button>
            </div>
          </div>
        </SectionCard>
      ) : (
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.today.sessionStartTitle}</p>
              <h2>{state.focusGoal.title}</h2>
              <p className="muted">{copy.today.sessionStartLead}</p>
            </div>
          </div>
          <div className="form-grid portfolio-form-grid">
            <label className="field">
              <span>{copy.today.fields.category}</span>
              <select className="input" value={sessionForm.category} onChange={(event) => setSessionForm((current) => ({ ...current, category: event.target.value, mainConnection: event.target.value === "main" ? "direct" : current.mainConnection }))}>
                <option value="main">{getLabel(locale, "main")}</option>
                <option value="improve">{getLabel(locale, "improve")}</option>
                <option value="admin">{getLabel(locale, "admin")}</option>
                <option value="other">{getLabel(locale, "other")}</option>
              </select>
            </label>
            <label className="field">
              <span>{copy.today.fields.quest}</span>
              <select className="input" value={sessionForm.questId} onChange={(event) => setSessionForm((current) => ({ ...current, questId: event.target.value }))}>
                {state.currentQuests.map((quest) => (
                  <option key={quest.id} value={quest.id}>
                    {quest.title}
                  </option>
                ))}
              </select>
            </label>
            {sessionForm.category !== "main" ? (
              <label className="field">
                <span>{copy.today.fields.mainConnection}</span>
                <select className="input" value={sessionForm.mainConnection} onChange={(event) => setSessionForm((current) => ({ ...current, mainConnection: event.target.value }))}>
                  <option value="direct">{getLabel(locale, "direct")}</option>
                  <option value="supporting">{getLabel(locale, "supporting")}</option>
                  <option value="unclear">{getLabel(locale, "unclear")}</option>
                </select>
              </label>
            ) : null}
            <label className="field">
              <span>{copy.today.fields.timebox}</span>
              <input className="input" min={5} max={180} type="number" value={sessionForm.timeboxMinutes} onChange={(event) => setSessionForm((current) => ({ ...current, timeboxMinutes: Number(event.target.value) }))} />
            </label>
            <label className="field field--full">
              <span>{copy.today.fields.artifact}</span>
              <textarea className="textarea" rows={2} value={sessionForm.artifactCommitment} onChange={(event) => setSessionForm((current) => ({ ...current, artifactCommitment: event.target.value }))} placeholder={copy.today.fields.artifactPlaceholder} />
            </label>
            <label className="field field--full">
              <span>{copy.today.fields.doneWhen}</span>
              <textarea className="textarea" rows={2} value={sessionForm.doneWhen} onChange={(event) => setSessionForm((current) => ({ ...current, doneWhen: event.target.value }))} placeholder={copy.today.fields.doneWhenPlaceholder} />
            </label>
          </div>
          <div className="button-row">
            <button className="button" disabled={isPending || !!state.currentWorkSession || !sessionForm.artifactCommitment.trim() || !sessionForm.doneWhen.trim()} onClick={handleSessionGate} type="button">
              {copy.today.buttons.runGate}
            </button>
          </div>
          {pendingGateDecision ? (
            <div className="queue-card">
              <div className="queue-card__header">
                <div>
                  <div className="pill-row">
                    <StatusPill label={pendingGateDecision.mode} />
                    <StatusPill label={pendingGateDecision.mainConnection} />
                  </div>
                  <h3>{pendingGateDecision.artifactCommitment}</h3>
                  <p className="muted">{pendingGateDecision.rationale}</p>
                </div>
              </div>
              <p><strong>{copy.today.labels.doneWhen}:</strong> {pendingGateDecision.doneWhen}</p>
              <p><strong>{copy.today.labels.timebox}:</strong> {pendingGateDecision.timeboxMinutes} {copy.common.minutes}</p>
              <div className="button-row">
                <button className="button" disabled={isPending} onClick={() => confirmSessionStart(pendingGateDecision)} type="button">
                  {copy.today.buttons.confirmStart}
                </button>
                {pendingGateDecision.mode === "avoidant" ? (
                  <Link className="button button--secondary" href="/return">
                    {copy.today.buttons.openReturnInstead}
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </SectionCard>
      )}

      <DisclosureSection
        eyebrow={copy.today.mirrorTitle}
        title={state.mirrorCard.headline}
        summary={state.mirrorCard.facts[0] ?? copy.today.openReturnHint}
        initialOpen={false}
        openLabel={copy.common.showDetails}
        closeLabel={copy.common.hideDetails}
        aside={<StatusPill label={state.mirrorCard.needsReturn ? "detour" : "fight"} />}
      >
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
        {state.mirrorCard.needsReturn ? (
          <Link className="button button--secondary" href="/return">
            {copy.common.openReturn}
          </Link>
        ) : null}
      </DisclosureSection>

      <DisclosureSection
        eyebrow={copy.today.todayPlanTitle}
        title={primaryPlanQuest?.title ?? plan.theme}
        summary={planSummary}
        initialOpen={false}
        openLabel={copy.common.showDetails}
        closeLabel={copy.common.hideDetails}
        aside={<StatusPill label={plan.mode} />}
        actions={
          <button className="button button--secondary" onClick={handleReplan} disabled={isPending} type="button">
            {aiEnabled ? copy.today.replanAi : copy.today.replanHeuristic}
          </button>
        }
      >
        {plan.quests.map((quest) => (
          <div className="quest-plan-card" key={`${quest.questId ?? quest.title}`}>
            <div className="quest-plan-card__header">
              <div>
                <h3>{quest.title}</h3>
                <p className="muted">{quest.reason}</p>
              </div>
              <div className="pill-row">
                <StatusPill label={quest.status} />
                <span className="pill">{quest.focusMinutes} {copy.common.minutes}</span>
              </div>
            </div>
            <p>{quest.successHint}</p>
          </div>
        ))}
        <ul className="bullet-list muted-list">
          {plan.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </DisclosureSection>

      <DisclosureSection
        eyebrow={copy.today.sessionsTitle}
        title={copy.today.sessionsTitle}
        summary={sessionSummary}
        initialOpen={false}
        openLabel={copy.common.showDetails}
        closeLabel={copy.common.hideDetails}
      >
        {state.todayWorkSessions.length ? (
          <div className="stack-lg">
            {state.todayWorkSessions.map((session) => {
              const decision = session.gateDecisionId ? decisionMap.get(session.gateDecisionId) : null;
              return (
                <div className="queue-card" key={session.id}>
                  <div className="queue-card__header">
                    <div>
                      <div className="pill-row">
                        <StatusPill label={session.category} />
                        {decision ? <StatusPill label={decision.mode} /> : null}
                      </div>
                      <h3>{decision?.artifactCommitment || state.currentQuests.find((quest) => quest.id === session.questId)?.title || copy.today.sessionStartTitle}</h3>
                      <p className="muted">{session.startedAt.slice(11, 16)} - {session.endedAt ? session.endedAt.slice(11, 16) : copy.common.running}</p>
                    </div>
                  </div>
                  <p><strong>{copy.today.labels.doneWhen}:</strong> {decision?.doneWhen || copy.common.noData}</p>
                  <p><strong>{copy.today.labels.artifactLeft}:</strong> {session.artifactNote || copy.common.noData}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">{copy.today.sessionsEmpty}</p>
        )}
      </DisclosureSection>

      <DisclosureSection
        eyebrow={copy.today.blockerTitle}
        title={copy.today.blockerTitle}
        summary={blockerSummary}
        initialOpen={false}
        openLabel={copy.common.showDetails}
        closeLabel={copy.common.hideDetails}
      >
        <div className="form-grid">
          <label className="field">
            <span>{copy.today.fields.blockerTitle}</span>
            <input className="input" value={blockerForm.title} onChange={(event) => setBlockerForm((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label className="field">
            <span>{copy.today.fields.blockerQuest}</span>
            <select className="input" value={blockerForm.relatedQuestId} onChange={(event) => setBlockerForm((current) => ({ ...current, relatedQuestId: event.target.value }))}>
              {state.currentQuests.map((quest) => (
                <option key={quest.id} value={quest.id}>
                  {quest.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--full">
            <span>{copy.today.fields.blockerDescription}</span>
            <textarea className="textarea" rows={3} value={blockerForm.description} onChange={(event) => setBlockerForm((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label className="field">
            <span>{copy.today.fields.blockerType}</span>
            <select className="input" value={blockerForm.blockerType} onChange={(event) => setBlockerForm((current) => ({ ...current, blockerType: event.target.value }))}>
              <option value="clarity">{getLabel(locale, "clarity")}</option>
              <option value="time">{getLabel(locale, "time")}</option>
              <option value="decision">{getLabel(locale, "decision")}</option>
              <option value="dependency">{getLabel(locale, "dependency")}</option>
              <option value="energy">{getLabel(locale, "energy")}</option>
              <option value="unknown">{getLabel(locale, "unknown")}</option>
            </select>
          </label>
          <label className="field">
            <span>{copy.today.fields.blockerSeverity}</span>
            <select className="input" value={blockerForm.severity} onChange={(event) => setBlockerForm((current) => ({ ...current, severity: event.target.value }))}>
              <option value="high">{getLabel(locale, "high")}</option>
              <option value="medium">{getLabel(locale, "medium")}</option>
              <option value="low">{getLabel(locale, "low")}</option>
            </select>
          </label>
        </div>
        <div className="button-row">
          <button className="button button--secondary" disabled={isPending || !blockerForm.title.trim()} onClick={handleCreateBlocker} type="button">
            {copy.today.buttons.recordBlocker}
          </button>
        </div>
        {latestBlocker ? (
          <div className="queue-card">
            <div className="pill-row">
              <StatusPill label={latestBlocker.blockerType} />
              <StatusPill label={latestBlocker.severity} />
            </div>
            <h3>{latestBlocker.title}</h3>
            <p className="muted">{latestBlocker.suggestedNextStep || copy.common.noData}</p>
          </div>
        ) : null}
      </DisclosureSection>
    </div>
  );
}