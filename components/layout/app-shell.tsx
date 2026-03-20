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
  const { state, aiMode, backendMode, clientStorageMode, deploymentTarget, updateUiPreferences } = useQuestAgent();
  const locale = state.uiPreferences.locale;
  const copy = getCopy(locale);
  const [showDetails, setShowDetails] = useState(false);
  const navItems = [
    { href: "/today", label: copy.nav.today },
    { href: "/portfolio", label: copy.nav.portfolio },
  ];
  const focusGoalTitle = state.focusGoal?.title ?? copy.portfolio.focusEmpty;
  const nextRestartLabel = state.resumeQueue[0]?.goal?.title ?? state.todaySuggestions[0]?.title ?? copy.common.noData;
  const activeGoalLabel = `${state.portfolioStats.activeGoalCount}/${state.portfolioStats.wipLimit}`;
  const contextualLinks = [
    { href: "/map", label: copy.nav.map },
    { href: "/review", label: copy.nav.review },
    { href: "/onboarding/intake", label: copy.nav.intake },
    ...(state.mirrorCard.needsReturn ? [{ href: "/return", label: copy.nav.returnFlow }] : []),
  ];

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
          {copy.shell.description ? <p className="muted">{copy.shell.description}</p> : null}
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
          <div className="button-row">
            <button className="button button--ghost" onClick={() => setShowDetails((current) => !current)} type="button">
              {showDetails ? copy.common.hideDetails : copy.common.showDetails}
            </button>
          </div>

          {showDetails ? (
            <div className="stack-lg">
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
                  <p className="eyebrow">{copy.shell.focus}</p>
                  <strong>{focusGoalTitle}</strong>
                  <p className="muted">{copy.shell.nextRestart}: {nextRestartLabel}</p>
                </div>
                <div className="pill-row">
                  <span className="pill pill--active">{copy.shell.activeGoalsPill} {activeGoalLabel}</span>
                </div>
              </div>

              <div className="stack-md">
                <p className="eyebrow">{copy.shell.environment}</p>
                <div className="pill-row">
                  <StatusPill label={deploymentTarget} />
                  <StatusPill label={clientStorageMode} />
                  <StatusPill label={backendMode} />
                  <StatusPill label={aiMode} />
                </div>
              </div>

              <div className="stack-md">
                <p className="eyebrow">{copy.shell.mirror}</p>
                <div className="button-row">
                  {contextualLinks.map((item) => (
                    <Link className="button button--secondary" href={item.href} key={item.href}>
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <main className="shell__main">
        <header className="topbar topbar--compact surface">
          <div>
            <p className="eyebrow">{copy.shell.focus}</p>
            <h2>{focusGoalTitle}</h2>
          </div>
          {state.mirrorCard.needsReturn ? (
            <Link className="button button--secondary" href="/return">
              {copy.common.openReturn}
            </Link>
          ) : null}
        </header>
        {children}
      </main>
    </div>
  );
}
