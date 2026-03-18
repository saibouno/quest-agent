import { NextResponse } from "next/server";

import { selectFocusGoal } from "@/lib/quest-agent/server/store";
import { focusGoalInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = focusGoalInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid focus goal payload." }, { status: 400 });
    }

    const goal = await selectFocusGoal(payload.data);
    return NextResponse.json({ data: goal });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to change focus goal." }, { status: 500 });
  }
}
