import { NextResponse } from "next/server";

import { createReview } from "@/lib/quest-agent/server/store";
import { reviewInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = reviewInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid review payload." }, { status: 400 });
    }

    const review = await createReview(payload.data);
    return NextResponse.json({ data: review });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save review." }, { status: 500 });
  }
}
