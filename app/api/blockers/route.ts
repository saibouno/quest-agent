import { NextResponse } from "next/server";

import { generateBlockerReroute } from "@/lib/quest-agent/server/ai";
import { createBlocker, getAppState } from "@/lib/quest-agent/server/store";
import { blockerInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = blockerInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid blocker payload." }, { status: 400 });
    }

    const state = await getAppState();
    const goal = state.goals.find((item) => item.id === payload.data.goalId);
    if (!goal) {
      return NextResponse.json({ error: "Goal not found." }, { status: 404 });
    }

    const reroute = await generateBlockerReroute(goal, {
      title: payload.data.title,
      description: payload.data.description,
      blockerType: payload.data.blockerType,
    });

    const blocker = await createBlocker({
      ...payload.data,
      suggestedNextStep: `${reroute.nextStep} / ${reroute.alternateRoute}`,
    });

    return NextResponse.json({ data: blocker, reroute });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create blocker." }, { status: 500 });
  }
}
