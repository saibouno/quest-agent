import { NextResponse } from "next/server";

import { updateQuestStatus } from "@/lib/quest-agent/server/store";
import { questStatusUpdateSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = questStatusUpdateSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid quest status payload." }, { status: 400 });
    }

    const quest = await updateQuestStatus(payload.data.questId, payload.data.status);
    return NextResponse.json({ data: quest });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update quest." }, { status: 500 });
  }
}
