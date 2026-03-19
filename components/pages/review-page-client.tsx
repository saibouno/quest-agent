"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { SectionCard } from "@/components/shared/section-card";
import { StatStrip } from "@/components/shared/stat-strip";
import { StatusPill } from "@/components/shared/status-pill";

function todayOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function ReviewPageClient() {
  const router = useRouter();
  const { state, clientStorageMode, createReview } = useQuestAgent();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    periodStart: todayOffset(-6),
    periodEnd: todayOffset(0),
    summary: "",
    learnings: "",
    rerouteNote: "",
    nextFocus: "",
  });

  const stats = useMemo(
    () => [
      { label: "Reviews", value: state.currentReviews.length, detail: "Saved weekly reviews" },
      { label: "Recent Events", value: state.recentEvents.length, detail: "Recent route history" },
      { label: "Completed This Week", value: state.stats.completedThisWeek, detail: "Visible progress" },
      { label: "Open Blockers", value: state.stats.openBlockerCount, detail: "Places that may need reroute" },
    ],
    [state],
  );

  if (!state.currentGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">Weekly Review</p>
        <h1>You need a goal before you can review the route.</h1>
        <Link className="button" href="/intake">
          Go to Quest Intake
        </Link>
      </SectionCard>
    );
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
          goalId: state.currentGoal!.id,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          summary: form.summary,
          learnings: form.learnings,
          rerouteNote: form.rerouteNote,
          nextFocus: form.nextFocus,
        });
        setMessage("Weekly review saved. The route can now reroute from evidence, not self-blame.");
        setForm({ periodStart: todayOffset(-6), periodEnd: todayOffset(0), summary: "", learnings: "", rerouteNote: "", nextFocus: "" });
        if (clientStorageMode === "server-backed") {
          router.refresh();
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Review save failed.");
      }
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">Weekly Review</p>
          <h1>When the route stalls, fix the design instead of blaming motivation.</h1>
          <p className="lead">Review is where Quest Agent turns friction into the next cleaner route.</p>
        </div>
      </section>

      <StatStrip items={stats} />
      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <div className="two-column two-column--wide">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Review Form</p>
              <h2>{state.currentGoal.title}</h2>
            </div>
            <StatusPill label={state.currentGoal.status} />
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Period Start</span>
              <input className="input" type="date" value={form.periodStart} onChange={(event) => updateField("periodStart", event.target.value)} />
            </label>
            <label className="field">
              <span>Period End</span>
              <input className="input" type="date" value={form.periodEnd} onChange={(event) => updateField("periodEnd", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>Progress Summary</span>
              <textarea className="textarea" rows={4} value={form.summary} onChange={(event) => updateField("summary", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>Learnings</span>
              <textarea className="textarea" rows={3} value={form.learnings} onChange={(event) => updateField("learnings", event.target.value)} />
            </label>
            <label className="field field--full">
              <span>Reroute Note</span>
              <textarea className="textarea" rows={3} value={form.rerouteNote} onChange={(event) => updateField("rerouteNote", event.target.value)} placeholder="What should change next?" />
            </label>
            <label className="field field--full">
              <span>Next Focus</span>
              <textarea className="textarea" rows={3} value={form.nextFocus} onChange={(event) => updateField("nextFocus", event.target.value)} placeholder="What matters most next week?" />
            </label>
          </div>

          <div className="button-row">
            <button className="button" disabled={isPending || !form.summary.trim()} onClick={handleSave} type="button">
              Save Weekly Review
            </button>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Saved Reviews</p>
              <h2>History</h2>
            </div>
          </div>

          {state.currentReviews.length ? (
            <div className="stack-lg">
              {state.currentReviews.map((review) => (
                <div className="milestone-card" key={review.id}>
                  <div className="milestone-card__header">
                    <div>
                      <p className="eyebrow">
                        {review.periodStart} - {review.periodEnd}
                      </p>
                      <h3>{review.summary}</h3>
                    </div>
                    <StatusPill label="completed" />
                  </div>
                  <p><strong>Learnings:</strong> {review.learnings || "-"}</p>
                  <p><strong>Reroute:</strong> {review.rerouteNote || "-"}</p>
                  <p><strong>Next Focus:</strong> {review.nextFocus || "-"}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No review yet. The first review makes the next reroute much easier.</p>
          )}
        </SectionCard>
      </div>

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">Recent Events</p>
            <h2>Route log</h2>
          </div>
        </div>
        <div className="event-list">
          {state.recentEvents.map((event) => (
            <div className="event-row" key={event.id}>
              <div>
                <strong>{event.type}</strong>
                <p className="muted">{new Date(event.createdAt).toLocaleString("ja-JP")}</p>
              </div>
              <code>{JSON.stringify(event.payload)}</code>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}