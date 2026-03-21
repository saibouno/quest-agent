import { blockerTypes, reservedRoleEventTypes, severityLevels } from "./types";
import type {
  QuestEvent,
  ReservedRoleEventPayloadMap,
  ReservedRoleEventType,
  ReservedRoleTraceEvent,
  UiLocale,
} from "./types";

const reservedRoleEventTypeSet = new Set<string>(reservedRoleEventTypes);

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function asMode(value: unknown): "ai" | "heuristic" {
  return value === "ai" ? "ai" : "heuristic";
}

function asBlockerType(value: unknown): ReservedRoleEventPayloadMap["skeptic_risk_flagged"]["blockerType"] {
  return blockerTypes.includes(value as (typeof blockerTypes)[number]) ? (value as (typeof blockerTypes)[number]) : "unknown";
}

function asSeverity(value: unknown): ReservedRoleEventPayloadMap["skeptic_risk_flagged"]["severity"] {
  return severityLevels.includes(value as (typeof severityLevels)[number]) ? (value as (typeof severityLevels)[number]) : "medium";
}

function truncate(value: string, maxLength = 84): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function describeMode(locale: UiLocale, mode: "ai" | "heuristic"): string {
  if (mode === "ai") {
    return "AI";
  }
  return locale === "ja" ? "rule" : "heuristic";
}

function normalizeReservedRolePayload<T extends ReservedRoleEventType>(
  type: T,
  payload: Record<string, unknown>,
): ReservedRoleEventPayloadMap[T] {
  switch (type) {
    case "scout_context_collected":
      return {
        refinementMode: asMode(payload.refinementMode),
        openQuestionCount: asCount(payload.openQuestionCount),
        hasFirstRouteNote: asBoolean(payload.hasFirstRouteNote),
      } as ReservedRoleEventPayloadMap[T];
    case "realist_plan_generated":
      return {
        mode: asMode(payload.mode),
        routeSummary: asString(payload.routeSummary),
        milestoneCount: asCount(payload.milestoneCount),
        questCount: asCount(payload.questCount),
      } as ReservedRoleEventPayloadMap[T];
    case "skeptic_risk_flagged":
      return {
        mode: asMode(payload.mode),
        diagnosis: asString(payload.diagnosis),
        alternateRoute: asString(payload.alternateRoute),
        reframing: asString(payload.reframing),
        blockerType: asBlockerType(payload.blockerType),
        severity: asSeverity(payload.severity),
      } as ReservedRoleEventPayloadMap[T];
    case "router_route_selected":
      return {
        mode: asMode(payload.mode),
        theme: asString(payload.theme),
        questTitles: asStringArray(payload.questTitles),
      } as ReservedRoleEventPayloadMap[T];
    case "archivist_snapshot_saved":
      return {
        summary: asString(payload.summary),
        hasRerouteNote: asBoolean(payload.hasRerouteNote),
        hasNextFocus: asBoolean(payload.hasNextFocus),
      } as ReservedRoleEventPayloadMap[T];
    case "user_profile_updated":
      return {} as ReservedRoleEventPayloadMap[T];
  }
}

export function isReservedRoleEventType(type: string): type is ReservedRoleEventType {
  return reservedRoleEventTypeSet.has(type);
}

export function getReservedRoleLabel(type: ReservedRoleEventType): string {
  switch (type) {
    case "scout_context_collected":
      return "Scout";
    case "realist_plan_generated":
      return "Realist";
    case "skeptic_risk_flagged":
      return "Skeptic";
    case "router_route_selected":
      return "Router";
    case "archivist_snapshot_saved":
      return "Archivist";
    case "user_profile_updated":
      return "Profile";
  }
}

export function buildReservedRoleTrace(
  events: Array<Pick<QuestEvent, "goalId" | "createdAt" | "type" | "payload">>,
  goalId: string,
): ReservedRoleTraceEvent[] {
  return events
    .filter((event): event is Pick<QuestEvent, "goalId" | "createdAt" | "payload"> & { type: ReservedRoleEventType } => (
      event.goalId === goalId && isReservedRoleEventType(event.type)
    ))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((event) => ({
      goalId: event.goalId,
      createdAt: event.createdAt,
      type: event.type,
      payload: normalizeReservedRolePayload(event.type, event.payload),
    }));
}

export function summarizeReservedRoleEvent(
  event: Pick<QuestEvent, "type" | "payload"> & { type: ReservedRoleEventType },
  locale: UiLocale,
): string {
  switch (event.type) {
    case "scout_context_collected": {
      const payload = normalizeReservedRolePayload("scout_context_collected", event.payload);
      const noteLabel = payload.hasFirstRouteNote
        ? "with first-route note"
        : "without first-route note";
      return `${describeMode(locale, payload.refinementMode)} intake, ${payload.openQuestionCount} open question(s), ${noteLabel}`;
    }
    case "realist_plan_generated": {
      const payload = normalizeReservedRolePayload("realist_plan_generated", event.payload);
      const summary = truncate(payload.routeSummary || "no route summary");
      return `${describeMode(locale, payload.mode)} route, ${payload.milestoneCount} milestone(s) / ${payload.questCount} quest(s), ${summary}`;
    }
    case "skeptic_risk_flagged": {
      const payload = normalizeReservedRolePayload("skeptic_risk_flagged", event.payload);
      const diagnosis = truncate(payload.diagnosis || payload.reframing || "no diagnosis");
      const alternateRoute = payload.alternateRoute ? truncate(payload.alternateRoute, 48) : "";
      return `${describeMode(locale, payload.mode)} risk, ${payload.blockerType} / ${payload.severity}, ${diagnosis}${alternateRoute ? `, alt: ${alternateRoute}` : ""}`;
    }
    case "router_route_selected": {
      const payload = normalizeReservedRolePayload("router_route_selected", event.payload);
      const questList = payload.questTitles.slice(0, 2).join(" / ");
      const extraCount = Math.max(0, payload.questTitles.length - 2);
      const extraLabel = extraCount ? ` +${extraCount} more` : "";
      const theme = truncate(payload.theme || "no theme", 56);
      return `${describeMode(locale, payload.mode)} route, ${theme}${questList ? `, ${questList}${extraLabel}` : ""}`;
    }
    case "archivist_snapshot_saved": {
      const payload = normalizeReservedRolePayload("archivist_snapshot_saved", event.payload);
      const summary = truncate(payload.summary || "no summary", 64);
      const flags = [
        payload.hasRerouteNote ? "reroute note saved" : "",
        payload.hasNextFocus ? "next focus saved" : "",
      ].filter(Boolean);
      return flags.length ? `${summary} (${flags.join(", ")})` : summary;
    }
    case "user_profile_updated":
      return "User profile updated";
  }
}
