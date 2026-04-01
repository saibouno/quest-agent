import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { updateUiPreferences } from "@/lib/quest-agent/server/store";
import { uiPreferencesInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = uiPreferencesInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid UI preferences payload.", 400);
    }

    const uiPreferences = await updateUiPreferences(payload.data);
    return jsonNoStore({ data: uiPreferences });
  } catch (error) {
    logRouteError("api/ui/preferences", error);
    return jsonError("Failed to update UI preferences.", 500);
  }
}
