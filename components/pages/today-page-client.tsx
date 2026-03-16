"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { SectionCard } from "@/components/shared/section-card";
import { StatStrip } from "@/components/shared/stat-strip";
import { StatusPill } from "@/components/shared/status-pill";
import type { AppState, Blocker, TodayPlan } from "@/lib/quest-agent/types";

export function TodayPageClient({ state, aiEnabled }: { state: AppState; aiEnabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [todayPlan, setTodayPlan] = useState<TodayPlan | null>(null);
  const [latestBlocker, setLatestBlocker] = useState<Blocker | null>(state.currentBlockers[0] ?? null);
  const [blockerForm, setBlockerForm] = useState({
    title: "",
    description: "",
    blockerType: "unknown",
    severity: "medium",
    relatedQuestId: state.currentQuests[0]?.id ?? "",
  });

  const stats = useMemo(
    () => [
      { label: "Ready Quests", value: state.currentQuests.filter((quest) => quest.status === "ready" || quest.status === "in_progress").length, detail: "今日動かしやすい quest" },
      { label: "Open Blockers", value: state.stats.openBlockerCount, detail: "詰まりを先に見える化" },
      { label: "Completed This Week", value: state.stats.completedThisWeek, detail: "小さな前進の蓄積" },
      { label: "Milestones", value: state.stats.milestoneCount, detail: "goal を支える段階数" },
    ],
    [state],
  );

  if (!state.currentGoal) {
    return (
      <SectionCard>
        <p className="eyebrow">Today&apos;s Quests</p>
        <h1>まずは Goal Intake を作成してください。</h1>
        <Link className="button" href="/intake">
          Quest Intake へ
        </Link>
      </SectionCard>
    );
  }

  if (!state.currentQuests.length) {
    return (
      <SectionCard>
        <p className="eyebrow">Today&apos;s Quests</p>
        <h1>今日の quest を出す前に route が必要です。</h1>
        <p className="muted">Quest Map を先に作ると、今日やる 1〜3 件が出しやすくなります。</p>
        <Link className="button" href="/map">
          Quest Map へ
        </Link>
      </SectionCard>
    );
  }

  const plan = todayPlan ?? {
    theme: "既存の route から、今日一番摩擦の低い quest を並べています。",
    quests: state.todaySuggestions,
    notes: [
      state.currentGoal.todayCapacity ? `今日使える余力: ${state.currentGoal.todayCapacity}` : "まずは 25〜45 分で終わるものから着手します。",
    ],
    mode: "heuristic" as const,
  };

  function updateQuestStatus(questId: string, status: "in_progress" | "completed" | "ready") {
    setError("");
    setMessage("");
    startTransition(async () => {
      const response = await fetch("/api/quests/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questId, status }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Quest update failed.");
        return;
      }
      setMessage(status === "completed" ? "Quest を完了にしました。" : "Quest の状態を更新しました。");
      router.refresh();
    });
  }

  function handleReplan() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const response = await fetch("/api/ai/plan-today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId: state.currentGoal?.id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Today&apos;s plan generation failed.");
        return;
      }
      setTodayPlan(payload.data as TodayPlan);
      setMessage(payload.data.mode === "ai" ? "AI が今日の route を再提案しました。" : "Heuristic mode で今日の route を再提案しました。");
      router.refresh();
    });
  }

  function handleCreateBlocker() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const response = await fetch("/api/blockers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId: state.currentGoal?.id,
          relatedQuestId: blockerForm.relatedQuestId || null,
          title: blockerForm.title,
          description: blockerForm.description,
          blockerType: blockerForm.blockerType,
          severity: blockerForm.severity,
          status: "open",
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Blocker save failed.");
        return;
      }
      setLatestBlocker(payload.data as Blocker);
      setBlockerForm({ title: "", description: "", blockerType: "unknown", severity: "medium", relatedQuestId: state.currentQuests[0]?.id ?? "" });
      setMessage("Blocker を記録しました。next step を route に取り込みます。");
      router.refresh();
    });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel surface">
        <div>
          <p className="eyebrow">Today&apos;s Quests</p>
          <h1>今日前に進める 1〜3 件に落とす。</h1>
          <p className="lead">完璧な計画より、今日の着手率と再始動率を上げる構成を優先します。</p>
        </div>
        <div className="hero-panel__actions">
          <button className="button" onClick={handleReplan} disabled={isPending} type="button">
            {aiEnabled ? "AI で今日を再計画" : "Heuristic で今日を再計画"}
          </button>
        </div>
      </section>

      <StatStrip items={stats} />
      {message ? <p className="feedback feedback--ok">{message}</p> : null}
      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <div className="two-column two-column--wide">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Today Plan</p>
              <h2>{plan.theme}</h2>
            </div>
            <StatusPill label={plan.mode} />
          </div>

          <div className="stack-lg">
            {plan.quests.map((quest) => (
              <div className="quest-plan-card" key={`${quest.questId ?? quest.title}`}>
                <div className="quest-plan-card__header">
                  <div>
                    <h3>{quest.title}</h3>
                    <p className="muted">{quest.reason}</p>
                  </div>
                  <div className="pill-row">
                    <StatusPill label={quest.status} />
                    <span className="pill">{quest.focusMinutes} min</span>
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
          </div>
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Quest Control</p>
              <h2>着手 / 完了 / ready に戻す</h2>
            </div>
          </div>

          <div className="quest-list">
            {state.currentQuests.map((quest) => (
              <div className="quest-row quest-row--stack" key={quest.id}>
                <div>
                  <div className="pill-row">
                    <StatusPill label={quest.priority} />
                    <StatusPill label={quest.status} />
                  </div>
                  <h3>{quest.title}</h3>
                  <p className="muted">{quest.description || "説明はまだありません。"}</p>
                </div>
                <div className="button-row">
                  <button className="button button--ghost" disabled={isPending} onClick={() => updateQuestStatus(quest.id, "ready")} type="button">
                    ready
                  </button>
                  <button className="button button--ghost" disabled={isPending} onClick={() => updateQuestStatus(quest.id, "in_progress")} type="button">
                    start
                  </button>
                  <button className="button button--secondary" disabled={isPending} onClick={() => updateQuestStatus(quest.id, "completed")} type="button">
                    complete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="two-column">
        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Blocker Intake</p>
              <h2>止まったら、責めずに route を直す</h2>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Title</span>
              <input className="input" value={blockerForm.title} onChange={(event) => setBlockerForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label className="field">
              <span>Related Quest</span>
              <select className="input" value={blockerForm.relatedQuestId} onChange={(event) => setBlockerForm((current) => ({ ...current, relatedQuestId: event.target.value }))}>
                {state.currentQuests.map((quest) => (
                  <option key={quest.id} value={quest.id}>
                    {quest.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--full">
              <span>Description</span>
              <textarea className="textarea" rows={3} value={blockerForm.description} onChange={(event) => setBlockerForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <label className="field">
              <span>Type</span>
              <select className="input" value={blockerForm.blockerType} onChange={(event) => setBlockerForm((current) => ({ ...current, blockerType: event.target.value }))}>
                <option value="clarity">clarity</option>
                <option value="time">time</option>
                <option value="decision">decision</option>
                <option value="dependency">dependency</option>
                <option value="energy">energy</option>
                <option value="unknown">unknown</option>
              </select>
            </label>
            <label className="field">
              <span>Severity</span>
              <select className="input" value={blockerForm.severity} onChange={(event) => setBlockerForm((current) => ({ ...current, severity: event.target.value }))}>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </label>
          </div>

          <div className="button-row">
            <button className="button" disabled={isPending || !blockerForm.title.trim()} onClick={handleCreateBlocker} type="button">
              Blocker を記録
            </button>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="section-header">
            <div>
              <p className="eyebrow">Reroute</p>
              <h2>最新の詰まりに対する next step</h2>
            </div>
          </div>

          {latestBlocker ? (
            <div className="draft-stack">
              <div>
                <div className="pill-row">
                  <StatusPill label={latestBlocker.blockerType} />
                  <StatusPill label={latestBlocker.severity} />
                  <StatusPill label={latestBlocker.status} />
                </div>
                <h3>{latestBlocker.title}</h3>
                <p className="muted">{latestBlocker.description}</p>
              </div>
              <div>
                <p className="eyebrow">Suggested Next Step</p>
                <p>{latestBlocker.suggestedNextStep || "Blocker を保存すると next step がここに出ます。"}</p>
              </div>
            </div>
          ) : (
            <p className="muted">まだ blocker はありません。止まった瞬間に記録すると、再始動率が上がります。</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

