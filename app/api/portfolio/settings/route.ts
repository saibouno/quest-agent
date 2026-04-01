import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { updatePortfolioSettings } from "@/lib/quest-agent/server/store";
import { portfolioSettingsInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = portfolioSettingsInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid portfolio settings payload.", 400);
    }

    const portfolioSettings = await updatePortfolioSettings(payload.data);
    return jsonNoStore({ data: portfolioSettings });
  } catch (error) {
    logRouteError("api/portfolio/settings", error);
    return jsonError("Failed to update portfolio settings.", 500);
  }
}
