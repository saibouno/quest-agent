import { NextResponse } from "next/server";

import { generateQuestMap } from "@/lib/quest-agent/server/ai";
import { generateMapRequestSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = generateMapRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid Quest Map payload." }, { status: 400 });
    }

    const goal = {
      id: payload.data.goalId,
      title: payload.data.title,
      description: payload.data.description,
      why: payload.data.why,
      deadline: payload.data.deadline || null,
      successCriteria: payload.data.successCriteria,
      currentState: payload.data.currentState,
      constraints: payload.data.constraints,
      concerns: payload.data.concerns,
      todayCapacity: "",
      status: "active" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const map = await generateQuestMap(goal);
    return NextResponse.json({ data: map });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate Quest Map." }, { status: 500 });
  }
}
