import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { startWorkSession } from "@/lib/quest-agent/server/store";
import { workSessionStartInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = workSessionStartInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid work session start payload.", 400);
    }

    const session = await startWorkSession(payload.data);
    return jsonNoStore({ data: session });
  } catch (error) {
    logRouteError("api/work-sessions/start", error);
    return jsonError("Failed to start work session.", 500);
  }
}
