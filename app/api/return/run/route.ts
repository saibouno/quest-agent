import { NextResponse } from "next/server";

import { recordReturnRun } from "@/lib/quest-agent/server/store";
import { returnRunInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = returnRunInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid return run payload." }, { status: 400 });
    }

    const returnRun = await recordReturnRun(payload.data);
    return NextResponse.json({ data: returnRun });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save return run." }, { status: 500 });
  }
}
