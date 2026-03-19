"use client";

import { useState, type PropsWithChildren, type ReactNode } from "react";

import { SectionCard } from "@/components/shared/section-card";

type DisclosureSectionProps = PropsWithChildren<{
  eyebrow?: string;
  title: string;
  summary?: string;
  initialOpen?: boolean;
  openLabel: string;
  closeLabel: string;
  aside?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
}>;

export function DisclosureSection({
  eyebrow,
  title,
  summary,
  initialOpen = false,
  openLabel,
  closeLabel,
  aside,
  actions,
  className = "",
  bodyClassName = "",
  children,
}: DisclosureSectionProps) {
  const [isOpen, setIsOpen] = useState(initialOpen);

  return (
    <SectionCard className={className}>
      <div className="disclosure">
        <div className="disclosure__header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2>{title}</h2>
            {summary ? <p className="muted">{summary}</p> : null}
          </div>
          <div className="disclosure__controls">
            {aside}
            {actions}
            <button className="button button--ghost" onClick={() => setIsOpen((current) => !current)} type="button">
              {isOpen ? closeLabel : openLabel}
            </button>
          </div>
        </div>
        {isOpen ? <div className={`disclosure__body ${bodyClassName}`.trim()}>{children}</div> : null}
      </div>
    </SectionCard>
  );
}