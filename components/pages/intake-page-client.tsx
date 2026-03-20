"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { DisclosureSection } from "@/components/shared/disclosure-section";
import { SectionCard } from "@/components/shared/section-card";
import { getCopy, getLabel, localizeRuntimeError } from "@/lib/quest-agent/copy";
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
  const { state } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const rootCopy = getCopy(locale);

  if (!state.focusGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">{rootCopy.intake.page}</p>
        <h1>{rootCopy.portfolio.focusEmpty}</h1>
        <p className="muted">{rootCopy.portfolio.focusBody}</p>
        <Link className="button" href="/portfolio">
          {rootCopy.common.openPortfolio}
        </Link>
      </SectionCard>
    );
  }

  return <IntakeEditor key={state.focusGoal.id} goal={state.focusGoal} />;
}

function IntakeEditor({ goal }: { goal: Goal }) {
  const router = useRouter();
  const { state, aiEnabled, clientStorageMode, refineIntake, saveGoal } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const rootCopy = getCopy(locale);
  const copy = rootCopy.intake;
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refinement, setRefinement] = useState<IntakeRefinement | null>(null);
  const [form, setForm] = useState(() => buildForm(goal));

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
        const savedGoal = await saveGoal({
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
          status: goal.status,
          refined: Boolean(refinement),
          intakeSnapshot: refinement
            ? {
                openQuestions: refinement.openQuestions,
                firstRouteNote: refinement.firstRouteNote,
                refinementMode: refinement.mode,
              }
            : undefined,
        });

        setMessage(copy.messages.savedActive);
        if (clientStorageMode === "server-backed") {
          router.refresh();
        }

        const hasRoute = state.currentMilestones.length > 0 || state.milestones.some((milestone) => milestone.goalId === savedGoal.id);
        router.push(hasRoute ? "/portfolio" : "/map");
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
          <h1>{copy.titleEdit}</h1>
          {copy.lead ? <p className="lead">{copy.lead}</p> : null}
        </div>
        <div className="hero-panel__actions">
          <button className="button button--secondary" disabled={isPending || !form.title.trim()} onClick={handleRefine} type="button">
            {aiEnabled ? copy.refineAi : copy.refineHeuristic}
          </button>
          <button className="button" disabled={isPending || !form.title.trim()} onClick={handleSave} type="button">
            {copy.saveGoal}
          </button>
        </div>
      </section>

      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">{copy.formTitle}</p>
            <h2>{copy.formLeadEdit}</h2>
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

      <DisclosureSection
        eyebrow={copy.draftTitle}
        title={copy.draftLead}
        summary={refinement ? refinement.goalSummary : copy.messages.emptyDraft}
        initialOpen={Boolean(refinement)}
        openLabel={rootCopy.common.showDetails}
        closeLabel={rootCopy.common.hideDetails}
      >
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
      </DisclosureSection>
    </div>
  );
}
