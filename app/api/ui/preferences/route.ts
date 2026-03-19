import { NextResponse } from "next/server";

import { updateUiPreferences } from "@/lib/quest-agent/server/store";
import { uiPreferencesInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = uiPreferencesInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid UI preferences payload." }, { status: 400 });
    }

    const uiPreferences = await updateUiPreferences(payload.data);
    return NextResponse.json({ data: uiPreferences });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update UI preferences." }, { status: 500 });
  }
}
