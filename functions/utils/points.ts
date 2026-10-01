import {STATUS_FLAGS} from "../constants/status";

export const POINTS_PER_UPVOTE = 1;
export const POINTS_PER_DOWNVOTE = 1;
export const POINTS_PER_CONFIRMED = 5;

export type PointsLedger = {earned: number; delta: number};

export const reconcileReporterPoints = (
  votes: Record<string, number> | undefined,
  status: string,
  prevAwarded: number,
): PointsLedger => {
  let ups = 0;
  let downs = 0;
  if (votes && typeof votes === "object") {
    for (const weight of Object.values(votes)) {
      if (typeof weight !== "number") continue;
      if (weight > 0) ups += Math.floor(weight);
      else downs += Math.floor(-weight);
    }
  }
  const score = ups * POINTS_PER_UPVOTE - downs * POINTS_PER_DOWNVOTE;
  const bonus = status === STATUS_FLAGS.CONFIRMED && score > 0 ?
    POINTS_PER_CONFIRMED :
    0;
  const earned = score * POINTS_PER_UPVOTE + bonus;
  return {earned, delta: earned - prevAwarded};
};

export const reporterHandle = (uid: string): string =>
  `rider-${uid.slice(0, 4).toLowerCase()}`;
