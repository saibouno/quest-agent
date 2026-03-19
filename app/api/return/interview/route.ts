import { NextResponse } from "next/server";

import { recordReturnInterview } from "@/lib/quest-agent/server/store";
import { returnInterviewInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = returnInterviewInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid return interview payload." }, { status: 400 });
    }

    const interview = await recordReturnInterview(payload.data);
    return NextResponse.json({ data: interview });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save return interview." }, { status: 500 });
  }
}
