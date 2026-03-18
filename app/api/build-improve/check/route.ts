import { NextResponse } from "next/server";

import { recordBuildImproveDecision } from "@/lib/quest-agent/server/store";
import { buildImproveCheckInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = buildImproveCheckInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid build/improve payload." }, { status: 400 });
    }

    const decision = await recordBuildImproveDecision(payload.data);
    return NextResponse.json({ data: decision });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to record build/improve decision." }, { status: 500 });
  }
}
