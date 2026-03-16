"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PropsWithChildren } from "react";

import { StatusPill } from "@/components/shared/status-pill";

const navItems = [
  { href: "/intake", label: "Quest Intake" },
  { href: "/map", label: "Quest Map" },
  { href: "/today", label: "Today's Quests" },
  { href: "/review", label: "Weekly Review" },
];

export function AppShell({
  children,
  summary,
}: PropsWithChildren<{
  summary: {
    currentGoalTitle: string;
    nextStepTitle: string;
    openBlockers: number;
    momentum: string;
    backendMode: "supabase" | "file";
    aiMode: string;
  };
}>) {
  const pathname = usePathname();

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div className="brand-card">
          <p className="brand-kicker">Quest Agent</p>
          <h1>Goal を、進められる route に変える。</h1>
          <p className="muted">
            目標設定、今日の一手、詰まりの reroute までを一つの流れで扱います。
          </p>
        </div>

        <nav className="nav-panel">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} className={`nav-link ${active ? "nav-link--active" : ""}`.trim()} href={item.href}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-surface">
          <p className="eyebrow">Current Goal</p>
          <strong>{summary.currentGoalTitle}</strong>
          <p className="muted">Next Step: {summary.nextStepTitle}</p>
          <div className="pill-row">
            <StatusPill label={summary.backendMode} />
            <StatusPill label={summary.aiMode} />
          </div>
        </div>
      </aside>

      <main className="shell__main">
        <header className="topbar surface">
          <div>
            <p className="eyebrow">Execution Probability</p>
            <h2>曖昧さを減らし、今日の前進を増やす。</h2>
          </div>
          <div className="topbar__stats">
            <div>
              <span className="eyebrow">Open Blockers</span>
              <strong>{summary.openBlockers}</strong>
            </div>
            <div>
              <span className="eyebrow">Momentum</span>
              <strong>{summary.momentum}</strong>
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
