import { generateReviewFocusReasons } from "@/lib/quest-agent/server/ai";
import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { reviewFocusReasonsRequestSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = reviewFocusReasonsRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid review focus reasons payload.", 400);
    }

    const reasons = await generateReviewFocusReasons(payload.data.candidates, payload.data.locale);
    return jsonNoStore({ data: reasons });
  } catch (error) {
    logRouteError("api/ai/review-focus-reasons", error);
    return jsonError("Failed to generate review focus reasons.", 500);
  }
}
