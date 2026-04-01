import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { createReview } from "@/lib/quest-agent/server/store";
import { reviewInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = reviewInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid review payload.", 400);
    }

    const review = await createReview(payload.data);
    return jsonNoStore({ data: review });
  } catch (error) {
    logRouteError("api/reviews", error);
    return jsonError("Failed to save review.", 500);
  }
}
