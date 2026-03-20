import { redirect } from "next/navigation";

import { RootEntryResolver } from "@/components/navigation/root-entry-resolver";
import { resolveHomePath } from "@/lib/quest-agent/derive";
import { getClientStorageHint } from "@/lib/quest-agent/server/runtime";
import { getAppState } from "@/lib/quest-agent/server/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (getClientStorageHint() === "browser-local") {
    return <RootEntryResolver />;
  }

  const state = await getAppState();
  redirect(resolveHomePath(state));
}
