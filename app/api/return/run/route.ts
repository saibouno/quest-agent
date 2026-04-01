import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { recordReturnRun } from "@/lib/quest-agent/server/store";
import { returnRunInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = returnRunInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid return run payload.", 400);
    }

    const returnRun = await recordReturnRun(payload.data);
    return jsonNoStore({ data: returnRun });
  } catch (error) {
    logRouteError("api/return/run", error);
    return jsonError("Failed to save return run.", 500);
  }
}
