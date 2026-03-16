"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { SectionCard } from "@/components/shared/section-card";
import { StatStrip } from "@/components/shared/stat-strip";
import { StatusPill } from "@/components/shared/status-pill";
import type { AppState } from "@/lib/quest-agent/types";

function todayOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function ReviewPageClient({ state }: { state: AppState }) {
  const router = useRouter();
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
      { label: "Reviews", value: state.currentReviews.length, detail: "保存済みの weekly review" },
      { label: "Recent Events", value: state.recentEvents.length, detail: "route の履歴" },
      { label: "Completed This Week", value: state.stats.completedThisWeek, detail: "前進の記録" },
      { label: "Open Blockers", value: state.stats.openBlockerCount, detail: "再設計が必要な箇所" },
    ],
    [state],
  );

  if (!state.currentGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">Weekly Review</p>
        <h1>review の前に goal が必要です。</h1>
        <Link className="button" href="/intake">
          Quest Intake へ
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
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId: state.currentGoal?.id,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          summary: form.summary,
          learnings: form.learnings,
          rerouteNote: form.rerouteNote,
          nextFocus: form.nextFocus,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Review save failed.");
        return;
      }
      setMessage("Weekly review を保存しました。route_changed event も記録されます。");
      setForm({ periodStart: todayOffset(-6), periodEnd: todayOffset(0), summary: "", learnings: "", rerouteNote: "", nextFocus: "" });
      router.refresh();
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">Weekly Review</p>
          <h1>うまくいかなかったら、根性ではなく設計を直す。</h1>
          <p className="lead">review は反省会ではなく reroute のための作業です。止まった理由を次の route 改善に変えます。</p>
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
              <textarea className="textarea" rows={3} value={form.rerouteNote} onChange={(event) => updateField("rerouteNote", event.target.value)} placeholder="何を変えるか" />
            </label>
            <label className="field field--full">
              <span>Next Focus</span>
              <textarea className="textarea" rows={3} value={form.nextFocus} onChange={(event) => updateField("nextFocus", event.target.value)} placeholder="来週何に集中するか" />
            </label>
          </div>

          <div className="button-row">
            <button className="button" disabled={isPending || !form.summary.trim()} onClick={handleSave} type="button">
              Weekly Review を保存
            </button>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Saved Reviews</p>
              <h2>履歴</h2>
            </div>
          </div>

          {state.currentReviews.length ? (
            <div className="stack-lg">
              {state.currentReviews.map((review) => (
                <div className="milestone-card" key={review.id}>
                  <div className="milestone-card__header">
                    <div>
                      <p className="eyebrow">{review.periodStart} - {review.periodEnd}</p>
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
            <p className="muted">まだ review はありません。最初の1本が、その後の reroute 品質を上げます。</p>
          )}
        </SectionCard>
      </div>

      <SectionCard>
        <div className="section-header">
          <div>
            <p className="eyebrow">Recent Events</p>
            <h2>進み方のログ</h2>
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
