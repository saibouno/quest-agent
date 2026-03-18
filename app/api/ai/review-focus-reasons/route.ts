import { NextResponse } from "next/server";

import { generateReviewFocusReasons } from "@/lib/quest-agent/server/ai";
import { reviewFocusReasonsRequestSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = reviewFocusReasonsRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid review focus reasons payload." }, { status: 400 });
    }

    const reasons = await generateReviewFocusReasons(payload.data.candidates, payload.data.locale);
    return NextResponse.json({ data: reasons });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate review focus reasons." }, { status: 500 });
  }
}
