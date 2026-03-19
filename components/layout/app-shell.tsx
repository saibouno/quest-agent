"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PropsWithChildren } from "react";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { StatusPill } from "@/components/shared/status-pill";

const navItems = [
  { href: "/intake", label: "Quest Intake" },
  { href: "/map", label: "Quest Map" },
  { href: "/today", label: "Today's Quests" },
  { href: "/review", label: "Weekly Review" },
];

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const { state, backendMode, aiMode } = useQuestAgent();

  const currentGoalTitle = state.currentGoal?.title ?? "No active goal yet";
  const nextStepTitle = state.todaySuggestions[0]?.title ?? "Start with Quest Intake";
  const momentum = `${state.stats.completedThisWeek} completed in the last 7 days`;

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div className="brand-card">
          <p className="brand-kicker">Quest Agent</p>
          <h1>Turn a serious goal into a route you can actually move through.</h1>
          <p className="muted">
            Intake, route design, today&apos;s step, blocker reroute, and weekly review stay in one flow.
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
          <strong>{currentGoalTitle}</strong>
          <p className="muted">Next Step: {nextStepTitle}</p>
          <div className="pill-row">
            <StatusPill label={backendMode} />
            <StatusPill label={aiMode} />
          </div>
        </div>
      </aside>

      <main className="shell__main">
        <header className="topbar surface">
          <div>
            <p className="eyebrow">Execution Probability</p>
            <h2>Reduce ambiguity, increase today&apos;s forward motion.</h2>
          </div>
          <div className="topbar__stats">
            <div>
              <span className="eyebrow">Open Blockers</span>
              <strong>{state.stats.openBlockerCount}</strong>
            </div>
            <div>
              <span className="eyebrow">Momentum</span>
              <strong>{momentum}</strong>
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

