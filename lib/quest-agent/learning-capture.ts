import { learningCaptureBuckets } from "./types";
import type { LearningCaptureBucket, QuestEvent, UiLocale } from "./types";

const learningCaptureBucketSet = new Set<string>(learningCaptureBuckets);

export function isLearningCaptureBucket(value: unknown): value is LearningCaptureBucket {
  return typeof value === "string" && learningCaptureBucketSet.has(value);
}

export function getLearningCaptureLabel(bucket: LearningCaptureBucket, locale: UiLocale): string {
  if (locale === "ja") {
    switch (bucket) {
      case "bug":
        return "バグ";
      case "friction":
        return "摩擦";
      case "misdiagnosis":
        return "見立て違い";
      case "good_intervention":
        return "良い介入";
      case "feature_request":
        return "機能要望";
    }
  }

  switch (bucket) {
    case "bug":
      return "Bug";
    case "friction":
      return "Friction";
    case "misdiagnosis":
      return "Misdiagnosis";
    case "good_intervention":
      return "Good intervention";
    case "feature_request":
      return "Feature request";
  }
}

export function buildReviewLearningBucketMap(
  events: Array<Pick<QuestEvent, "goalId" | "entityId" | "type" | "payload">>,
  goalId: string,
): Map<string, LearningCaptureBucket> {
  const buckets = new Map<string, LearningCaptureBucket>();
  for (const event of events) {
    if (event.goalId !== goalId || event.type !== "weekly_review_done") {
      continue;
    }
    const bucket = event.payload.learningBucket;
    if (isLearningCaptureBucket(bucket) && !buckets.has(event.entityId)) {
      buckets.set(event.entityId, bucket);
    }
  }
  return buckets;
}
