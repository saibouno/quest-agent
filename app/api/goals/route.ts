import { NextResponse } from "next/server";

import { saveGoal } from "@/lib/quest-agent/server/store";
import { goalInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = goalInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid goal payload." }, { status: 400 });
    }

    const goal = await saveGoal(payload.data);
    return NextResponse.json({ data: goal });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save goal." }, { status: 500 });
  }
}
