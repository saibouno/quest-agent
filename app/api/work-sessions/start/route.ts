import { NextResponse } from "next/server";

import { startWorkSession } from "@/lib/quest-agent/server/store";
import { workSessionStartInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = workSessionStartInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid work session start payload." }, { status: 400 });
    }

    const session = await startWorkSession(payload.data);
    return NextResponse.json({ data: session });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to start work session." }, { status: 500 });
  }
}
