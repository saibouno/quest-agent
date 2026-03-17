import { NextResponse } from "next/server";

import { generateBlockerReroute } from "@/lib/quest-agent/server/ai";
import { getAppState } from "@/lib/quest-agent/server/store";
import { rerouteRequestSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = rerouteRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid reroute payload." }, { status: 400 });
    }

    const state = await getAppState();
    const goal = payload.data.goalSnapshot ?? (payload.data.goalId ? state.goals.find((item) => item.id === payload.data.goalId) : null);
    if (!goal) {
      return NextResponse.json({ error: "Goal not found." }, { status: 404 });
    }

    const reroute = await generateBlockerReroute(goal, {
      title: payload.data.title,
      description: payload.data.description,
      blockerType: payload.data.blockerType,
    });

    return NextResponse.json({ data: reroute });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reroute blocker." }, { status: 500 });
  }
}