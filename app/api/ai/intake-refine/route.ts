import { NextResponse } from "next/server";

import { generateIntakeRefinement } from "@/lib/quest-agent/server/ai";
import { intakeRefineRequestSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = intakeRefineRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid intake payload." }, { status: 400 });
    }

    const refinement = await generateIntakeRefinement(payload.data);
    return NextResponse.json({ data: refinement });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to refine goal." }, { status: 500 });
  }
}
