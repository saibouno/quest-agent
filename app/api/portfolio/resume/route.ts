import { NextResponse } from "next/server";

import { resumeGoal } from "@/lib/quest-agent/server/store";
import { resumeGoalInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = resumeGoalInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid resume goal payload." }, { status: 400 });
    }

    const goal = await resumeGoal(payload.data);
    return NextResponse.json({ data: goal });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to resume goal." }, { status: 500 });
  }
}
