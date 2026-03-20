import type { PropsWithChildren } from "react";

export default function OnboardingLayout({ children }: PropsWithChildren) {
  return (
    <div className="onboarding-shell">
      <div className="onboarding-panel">{children}</div>
    </div>
  );
}
