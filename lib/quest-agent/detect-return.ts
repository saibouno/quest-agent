import type {
  BuildImproveDecision,
  LeadMetricsDaily,
  MetaWorkFlag,
  MetaWorkFlagType,
  MirrorCard,
  PersistedState,
  ReturnRun,
  UiLocale,
  WorkSession,
} from "@/lib/quest-agent/types";

function nowIso(): string {
  return new Date().toISOString();
}

export function dayKeyFromIso(iso: string): string {
  return iso.slice(0, 10);
}

function todayKey(): string {
  return dayKeyFromIso(nowIso());
}

export function getSessionMinutes(session: WorkSession): number {
  if (!session.endedAt) {
    return session.plannedMinutes;
  }

  const duration = Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60000);
  return Math.max(session.plannedMinutes, Number.isFinite(duration) ? duration : session.plannedMinutes);
}

function average(values: number[]): number | null {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildFlagMessage(flagType: MetaWorkFlagType, metrics: LeadMetricsDaily, sessions: WorkSession[], locale: UiLocale): string {
  const closedWithoutArtifact = sessions.filter((session) => session.endedAt && !session.artifactNote.trim()).length;

  switch (flagType) {
    case "main_work_absent":
      return locale === "ja"
        ? `メインがまだ${metrics.mainWorkRatio === 0 ? "0分" : "15分以下"}です。`
        : `Main work is still at ${metrics.mainWorkRatio === 0 ? "0 minutes" : "15 minutes or less"}.`;
    case "meta_overweight":
      return locale === "ja"
        ? "改善やその他の時間が、メインより重くなっている。"
        : "Avoidant improve / other work is outweighing main work.";
    case "start_delay":
      if (metrics.startDelayMinutes === null) {
        return locale === "ja"
          ? "最初の作業から、まだメインに入れていない。"
          : "Main work has not started yet after the first session.";
      }
      return locale === "ja"
        ? `最初の作業からメインに入るまで${metrics.startDelayMinutes}分かかっている。`
        : `It took ${metrics.startDelayMinutes} minutes to reach main work after the first session.`;
    case "switch_density":
      return locale === "ja"
        ? `切替が${metrics.switchDensity}回ある。`
        : `There were ${metrics.switchDensity} goal / category switches.`;
    case "unfinished_chain":
      return locale === "ja"
        ? `${closedWithoutArtifact}件のセッションが、成果物なしで終わっている。`
        : `${closedWithoutArtifact} sessions ended without leaving an artifact.`;
    case "uncertainty_loop":
      return locale === "ja"
        ? "曖昧さの確認が続いている。短く戻すと立て直しやすい。"
        : "Unclear or avoidant checks are stacking up, so a short return step may help.";
    default:
      return locale === "ja" ? "短く戻すタイミングが来ている。" : "There is a short return point to consider.";
  }
}

function buildEmptyMetrics(dayKey: string): LeadMetricsDaily {
  return {
    dayKey,
    mainWorkRatio: 0,
    metaWorkRatio: 0,
    startDelayMinutes: null,
    resumeDelayMinutes: null,
    switchDensity: 0,
    ifThenCoverage: 0,
    monitoringDone: false,
  };
}

type DayBucket = {
  dayKey: string;
  sessions: WorkSession[];
  decisions: BuildImproveDecision[];
  returnRuns: ReturnRun[];
  goalSwitchEvents: number;
  resumeDelays: number[];
};

function getOrCreateBucket(buckets: Map<string, DayBucket>, dayKey: string): DayBucket {
  const existing = buckets.get(dayKey);
  if (existing) {
    return existing;
  }

  const bucket: DayBucket = {
    dayKey,
    sessions: [],
    decisions: [],
    returnRuns: [],
    goalSwitchEvents: 0,
    resumeDelays: [],
  };
  buckets.set(dayKey, bucket);
  return bucket;
}

export function rebuildTrackingCollections(state: PersistedState): Pick<PersistedState, "metaWorkFlags" | "leadMetricsDaily"> {
  const locale = state.uiPreferences.locale;
  const buckets = new Map<string, DayBucket>();
  const decisionMap = new Map(state.buildImproveDecisions.map((decision) => [decision.id, decision]));
  const resumeEvents = state.events.filter((event) => event.type === "goal_resumed");

  for (const session of state.workSessions) {
    getOrCreateBucket(buckets, dayKeyFromIso(session.startedAt)).sessions.push(session);
  }

  for (const decision of state.buildImproveDecisions) {
    getOrCreateBucket(buckets, dayKeyFromIso(decision.createdAt)).decisions.push(decision);
  }

  for (const run of state.returnRuns) {
    getOrCreateBucket(buckets, dayKeyFromIso(run.createdAt)).returnRuns.push(run);
  }

  for (const event of state.events) {
    if (event.type === "goal_switch_recorded") {
      getOrCreateBucket(buckets, dayKeyFromIso(event.createdAt)).goalSwitchEvents += 1;
    }
  }

  for (const item of state.resumeQueueItems.filter((resumeItem) => resumeItem.status === "resumed")) {
    const resumeEvent = resumeEvents.find((event) => event.goalId === item.goalId && event.createdAt >= item.parkedAt);
    if (!resumeEvent) {
      continue;
    }

    const resumeDelay = Math.round((new Date(resumeEvent.createdAt).getTime() - new Date(item.parkedAt).getTime()) / 60000);
    if (Number.isFinite(resumeDelay)) {
      getOrCreateBucket(buckets, dayKeyFromIso(resumeEvent.createdAt)).resumeDelays.push(Math.max(0, resumeDelay));
    }
  }

  const leadMetricsDaily: LeadMetricsDaily[] = [];
  const metaWorkFlags: MetaWorkFlag[] = [];

  for (const bucket of [...buckets.values()].sort((left, right) => right.dayKey.localeCompare(left.dayKey))) {
    const sessions = [...bucket.sessions].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    const trackedMinutes = sessions.reduce((sum, session) => sum + getSessionMinutes(session), 0);
    const mainSessions = sessions.filter((session) => session.category === "main");
    const mainMinutes = mainSessions.reduce((sum, session) => sum + getSessionMinutes(session), 0);
    const avoidantMinutes = sessions.reduce((sum, session) => {
      const decision = session.gateDecisionId ? decisionMap.get(session.gateDecisionId) : null;
      if (!decision || decision.mode !== "avoidant") {
        return sum;
      }
      if (session.category !== "improve" && session.category !== "other") {
        return sum;
      }
      return sum + getSessionMinutes(session);
    }, 0);
    const firstSession = sessions[0] ?? null;
    const firstMainSession = mainSessions[0] ?? null;
    const startDelayMinutes = firstSession && firstMainSession
      ? Math.max(0, Math.round((new Date(firstMainSession.startedAt).getTime() - new Date(firstSession.startedAt).getTime()) / 60000))
      : null;
    const categorySwitches = sessions.reduce((count, session, index) => {
      if (index === 0) {
        return count;
      }
      return count + (sessions[index - 1]?.category !== session.category ? 1 : 0);
    }, 0);
    const metrics: LeadMetricsDaily = {
      dayKey: bucket.dayKey,
      mainWorkRatio: trackedMinutes ? Number((mainMinutes / trackedMinutes).toFixed(2)) : 0,
      metaWorkRatio: trackedMinutes ? Number((avoidantMinutes / trackedMinutes).toFixed(2)) : 0,
      startDelayMinutes,
      resumeDelayMinutes: average(bucket.resumeDelays),
      switchDensity: bucket.goalSwitchEvents + categorySwitches,
      ifThenCoverage: bucket.returnRuns.length
        ? Number((bucket.returnRuns.filter((run) => run.ifThenPlan.trim().length > 0).length / bucket.returnRuns.length).toFixed(2))
        : 0,
      monitoringDone: sessions.length > 0 || bucket.returnRuns.length > 0,
    };
    leadMetricsDaily.push(metrics);

    const flaggedTypes: MetaWorkFlagType[] = [];
    const nonMainMinutes = trackedMinutes - mainMinutes;
    if (mainMinutes <= 15 && nonMainMinutes >= 15) {
      flaggedTypes.push("main_work_absent");
    }
    if (avoidantMinutes > 0 && (mainMinutes === 0 ? avoidantMinutes >= 15 : avoidantMinutes >= mainMinutes * 3)) {
      flaggedTypes.push("meta_overweight");
    }
    if ((startDelayMinutes !== null && startDelayMinutes >= 60) || (startDelayMinutes === null && trackedMinutes >= 60 && mainMinutes === 0)) {
      flaggedTypes.push("start_delay");
    }
    if (metrics.switchDensity >= 3) {
      flaggedTypes.push("switch_density");
    }
    if (sessions.filter((session) => session.endedAt && !session.artifactNote.trim()).length >= 2) {
      flaggedTypes.push("unfinished_chain");
    }
    if (bucket.decisions.filter((decision) => decision.mode === "avoidant" || decision.mainConnection === "unclear").length >= 2) {
      flaggedTypes.push("uncertainty_loop");
    }

    for (const flagType of flaggedTypes) {
      metaWorkFlags.push({
        id: `${bucket.dayKey}:${flagType}`,
        goalId: sessions[0]?.goalId ?? bucket.decisions[0]?.goalId ?? bucket.returnRuns[0]?.goalId ?? null,
        dayKey: bucket.dayKey,
        flagType,
        message: buildFlagMessage(flagType, metrics, sessions, locale),
        createdAt: sessions[0]?.startedAt ?? bucket.decisions[0]?.createdAt ?? bucket.returnRuns[0]?.createdAt ?? `${bucket.dayKey}T00:00:00.000Z`,
      });
    }
  }

  return {
    metaWorkFlags,
    leadMetricsDaily,
  };
}

export function buildMirrorCard(state: PersistedState, locale: UiLocale = state.uiPreferences.locale): MirrorCard {
  const dayKey = todayKey();
  const todayMetrics = state.leadMetricsDaily.find((item) => item.dayKey === dayKey) ?? buildEmptyMetrics(dayKey);
  const todayFlags = state.metaWorkFlags.filter((item) => item.dayKey === dayKey);
  const todaySessions = state.workSessions.filter((session) => dayKeyFromIso(session.startedAt) === dayKey);
  const decisionMap = new Map(state.buildImproveDecisions.map((decision) => [decision.id, decision]));
  const mainMinutes = todaySessions
    .filter((session) => session.category === "main")
    .reduce((sum, session) => sum + getSessionMinutes(session), 0);
  const metaMinutes = todaySessions.reduce((sum, session) => {
    const decision = session.gateDecisionId ? decisionMap.get(session.gateDecisionId) : null;
    if (!decision || decision.mode !== "avoidant") {
      return sum;
    }
    if (session.category !== "improve" && session.category !== "other") {
      return sum;
    }
    return sum + getSessionMinutes(session);
  }, 0);

  if (!todayFlags.length) {
    return {
      dayKey,
      headline: todaySessions.length
        ? (locale === "ja" ? "今日はまだ大きくズレていない。" : "Work is still tracking the main quest.")
        : (locale === "ja" ? "まだ作業は始まっていない。" : "No work session has started yet."),
      facts: todaySessions.length
        ? [
            locale === "ja"
              ? `メイン ${mainMinutes}分 / メタ ${metaMinutes}分`
              : `Main ${mainMinutes} minutes / Meta ${metaMinutes} minutes`,
            todayMetrics.startDelayMinutes === null
              ? (locale === "ja" ? "メイン開始までの遅れはまだ出ていない。" : "Start delay is not measured yet.")
              : (locale === "ja"
                  ? `メイン開始まで ${todayMetrics.startDelayMinutes}分`
                  : `It took ${todayMetrics.startDelayMinutes} minutes to reach main work.`),
          ]
        : [locale === "ja" ? "まずは最初の15分を切り出す。" : "Use Session Start to carve out the first 15 minutes."],
      needsReturn: false,
      mainMinutes,
      metaMinutes,
      startDelayMinutes: todayMetrics.startDelayMinutes,
      switchDensity: todayMetrics.switchDensity,
    };
  }

  return {
    dayKey,
    headline: todayFlags[0]?.message ?? (locale === "ja" ? "短く戻すタイミングが来ている。" : "A short return point is showing up."),
    facts: todayFlags.map((flag) => flag.message).slice(0, 3),
    needsReturn: true,
    mainMinutes,
    metaMinutes,
    startDelayMinutes: todayMetrics.startDelayMinutes,
    switchDensity: todayMetrics.switchDensity,
  };
}