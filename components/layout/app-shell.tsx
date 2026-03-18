"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type PropsWithChildren } from "react";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { StatusPill } from "@/components/shared/status-pill";
import { getCopy } from "@/lib/quest-agent/copy";
import type { UiLocale } from "@/lib/quest-agent/types";

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const { state, backendMode, aiMode, updateUiPreferences } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale);
  const [showEnvironment, setShowEnvironment] = useState(false);
  const navItems = [
    { href: "/portfolio", label: copy.nav.portfolio },
    { href: "/intake", label: copy.nav.intake },
    { href: "/map", label: copy.nav.map },
    { href: "/today", label: copy.nav.today },
    { href: "/return", label: copy.nav.returnFlow },
    { href: "/review", label: copy.nav.review },
  ];

  const focusGoalTitle = state.focusGoal?.title ?? copy.portfolio.focusEmpty;
  const nextRestartLabel = state.resumeQueue[0]?.goal?.title ?? state.todaySuggestions[0]?.title ?? copy.common.noData;
  const activeGoalLabel = `${state.portfolioStats.activeGoalCount}/${state.portfolioStats.wipLimit}`;

  async function handleLocaleChange(nextLocale: UiLocale) {
    if (nextLocale === locale) {
      return;
    }
    await updateUiPreferences({ locale: nextLocale });
  }

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div className="brand-card">
          <p className="brand-kicker">{copy.shell.kicker}</p>
          <h1>{copy.shell.title}</h1>
          <p className="muted">{copy.shell.description}</p>
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

        <div className="sidebar-surface stack-md">
          <div>
            <p className="eyebrow">{copy.shell.localeLabel}</p>
            <div className="button-row">
              <button className={locale === "ja" ? "button" : "button button--ghost"} onClick={() => void handleLocaleChange("ja")} type="button">
                {copy.shell.languageJa}
              </button>
              <button className={locale === "en" ? "button" : "button button--ghost"} onClick={() => void handleLocaleChange("en")} type="button">
                {copy.shell.languageEn}
              </button>
            </div>
          </div>

          <div className="stack-md">
            <div>
              <p className="eyebrow">{copy.shell.mirror}</p>
              <strong>{state.mirrorCard.headline}</strong>
              <p className="muted">{copy.shell.focus}: {focusGoalTitle}</p>
              <p className="muted">{copy.shell.nextRestart}: {nextRestartLabel}</p>
            </div>
            <div className="button-row">
              <span className="pill pill--active">{copy.shell.activeGoalsPill} {activeGoalLabel}</span>
              {state.mirrorCard.needsReturn ? (
                <Link className="button button--secondary" href="/return">
                  {copy.common.openReturn}
                </Link>
              ) : null}
              <button className="button button--ghost" onClick={() => setShowEnvironment((current) => !current)} type="button">
                {showEnvironment ? copy.common.hideDetails : copy.common.showDetails}
              </button>
            </div>
            {showEnvironment ? (
              <div className="stack-md">
                <p className="eyebrow">{copy.shell.environment}</p>
                <div className="pill-row">
                  <StatusPill label={backendMode} />
                  <StatusPill label={aiMode} />
                  <StatusPill label={state.mirrorCard.needsReturn ? "detour" : "fight"} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <main className="shell__main">
        <header className="topbar topbar--compact surface">
          <div>
            <p className="eyebrow">{copy.shell.focus}</p>
            <h2>{focusGoalTitle}</h2>
          </div>
          <div className="button-row">
            <span className="pill pill--active">{copy.shell.activeGoals} {activeGoalLabel}</span>
            {state.mirrorCard.needsReturn ? (
              <Link className="button button--secondary" href="/return">
                {copy.common.openReturn}
              </Link>
            ) : null}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}