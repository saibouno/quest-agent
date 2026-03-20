import { redirect } from "next/navigation";

import { IntakePageClient } from "@/components/pages/intake-page-client";

export const dynamic = "force-dynamic";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[] }>;
}) {
  const params = await searchParams;
  const newParam = Array.isArray(params.new) ? params.new[0] : params.new;
  if (newParam === "1") {
    redirect("/onboarding/intake");
  }

  return <IntakePageClient />;
}
