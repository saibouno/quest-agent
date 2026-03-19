import { NextResponse } from "next/server";

import { updatePortfolioSettings } from "@/lib/quest-agent/server/store";
import { portfolioSettingsInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = portfolioSettingsInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid portfolio settings payload." }, { status: 400 });
    }

    const portfolioSettings = await updatePortfolioSettings(payload.data);
    return NextResponse.json({ data: portfolioSettings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update portfolio settings." }, { status: 500 });
  }
}
