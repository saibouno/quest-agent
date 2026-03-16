import type { PropsWithChildren } from "react";

export function SectionCard({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <section className={`surface ${className}`.trim()}>{children}</section>;
}
