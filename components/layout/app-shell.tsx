"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PropsWithChildren } from "react";

import { useQuestAgent } from "@/components/providers/quest-agent-provider";
import { StatusPill } from "@/components/shared/status-pill";
import { getCopy } from "@/lib/quest-agent/copy";
import type { UiLocale } from "@/lib/quest-agent/types";

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const { state, backendMode, aiMode, updateUiPreferences } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale);
  const navItems = [
    { href: "/portfolio", label: copy.nav.portfolio },
    { href: "/intake", label: copy.nav.intake },
    { href: "/map", label: copy.nav.map },
    { href: "/today", label: copy.nav.today },
    { href: "/return", label: copy.nav.returnFlow },
    { href: "/review", label: copy.nav.review },
  ];

  const focusGoalTitle = state.focusGoal?.title ?? copy.portfolio.focusEmpty;
  const nextRestartLabel = state.resumeQueue[0]?.goal?.title ?? state.todaySuggestions[0]?.title ?? copy.common.openPortfolio;
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

          <div>
            <p className="eyebrow">{copy.shell.mirror}</p>
            <strong>{state.mirrorCard.headline}</strong>
            <p className="muted">{copy.shell.focus}: {focusGoalTitle}</p>
            <p className="muted">{copy.shell.nextRestart}: {nextRestartLabel}</p>
            <div className="pill-row">
              <span className="pill pill--active">{copy.shell.activeGoalsPill} {activeGoalLabel}</span>
              <StatusPill label={backendMode} />
              <StatusPill label={aiMode} />
              <StatusPill label={state.mirrorCard.needsReturn ? "detour" : "fight"} />
            </div>
          </div>
        </div>
      </aside>

      <main className="shell__main">
        <header className="topbar surface">
          <div>
            <p className="eyebrow">{copy.shell.portfolioHealth}</p>
            <h2>{copy.shell.healthTitle}</h2>
          </div>
          <div className="topbar__stats">
            <div>
              <span className="eyebrow">{copy.shell.activeGoals}</span>
              <strong>{activeGoalLabel}</strong>
            </div>
            <div>
              <span className="eyebrow">{copy.shell.mainToday}</span>
              <strong>{state.mirrorCard.mainMinutes}{copy.common.minutes}</strong>
            </div>
            <div>
              <span className="eyebrow">{copy.shell.switchDensity}</span>
              <strong>{state.mirrorCard.switchDensity}</strong>
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}