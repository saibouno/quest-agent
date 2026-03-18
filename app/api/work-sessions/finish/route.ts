import { NextResponse } from "next/server";

import { finishWorkSession } from "@/lib/quest-agent/server/store";
import { workSessionFinishInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = workSessionFinishInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid work session finish payload." }, { status: 400 });
    }

    const session = await finishWorkSession(payload.data);
    return NextResponse.json({ data: session });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to finish work session." }, { status: 500 });
  }
}
