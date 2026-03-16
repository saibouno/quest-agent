import { ReviewPageClient } from "@/components/pages/review-page-client";
import { getAppState } from "@/lib/quest-agent/server/store";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const state = await getAppState();
  return <ReviewPageClient state={state} />;
}
