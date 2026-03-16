import { NextResponse } from "next/server";

import { replaceMap } from "@/lib/quest-agent/server/store";
import { mapDraftSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = mapDraftSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid map payload." }, { status: 400 });
    }

    await replaceMap({
      ...payload.data,
      milestones: payload.data.milestones.map((milestone) => ({
        ...milestone,
        targetDate: milestone.targetDate ?? null,
        quests: milestone.quests.map((quest) => ({
          ...quest,
          dueDate: quest.dueDate ?? null,
          estimatedMinutes: quest.estimatedMinutes ?? null,
        })),
      })),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save Quest Map." }, { status: 500 });
  }
}

