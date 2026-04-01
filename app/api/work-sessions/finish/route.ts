import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { finishWorkSession } from "@/lib/quest-agent/server/store";
import { workSessionFinishInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = workSessionFinishInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid work session finish payload.", 400);
    }

    const session = await finishWorkSession(payload.data);
    return jsonNoStore({ data: session });
  } catch (error) {
    logRouteError("api/work-sessions/finish", error);
    return jsonError("Failed to finish work session.", 500);
  }
}
