import { SectionCard } from "@/components/shared/section-card";

export function StatStrip({
  items,
}: {
  items: Array<{ label: string; value: string | number; detail?: string }>;
}) {
  return (
    <div className="stat-grid">
      {items.map((item) => (
        <SectionCard key={item.label} className="stat-card">
          <p className="eyebrow">{item.label}</p>
          <strong className="stat-value">{item.value}</strong>
          {item.detail ? <p className="muted">{item.detail}</p> : null}
        </SectionCard>
      ))}
    </div>
  );
}
