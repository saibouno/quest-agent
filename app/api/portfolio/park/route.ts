import { NextResponse } from "next/server";

import { parkGoal } from "@/lib/quest-agent/server/store";
import { parkGoalInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = parkGoalInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid park goal payload." }, { status: 400 });
    }

    const goal = await parkGoal(payload.data);
    return NextResponse.json({ data: goal });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to park goal." }, { status: 500 });
  }
}
