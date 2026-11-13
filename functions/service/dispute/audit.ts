import * as auditService from "../auditService";
import type {Dispute} from "../../repository/disputeRepository";
import {DISPUTE_STATUS} from "../../constants/disputes";

const recordDisputeResolved = async ({
  by,
  dispute,
  outcome,
  resolution,
  adjustedAmount,
}: {
  by: string;
  dispute: Dispute;
  outcome: string;
  resolution: string;
  adjustedAmount?: number;
}): Promise<void> => {
  await auditService.record({
    adminUid: by,
    action: "DISPUTE_RESOLVED",
    category: "CASE",
    targetType: "DISPUTE",
    targetId: dispute.id,
    targetLabel: dispute.ticketId,
    before: {status: dispute.status, outcome: dispute.outcome},
    after: {status: DISPUTE_STATUS.RESOLVED, outcome},
    note: resolution,
    meta: {
      type: dispute.type,
      ...(typeof adjustedAmount === "number" ? {adjustedAmount} : {}),
    },
  });
};

const recordDisputeDismissed = async ({
  by,
  dispute,
  resolution,
}: {
  by: string;
  dispute: Dispute;
  resolution?: string;
}): Promise<void> => {
  await auditService.record({
    adminUid: by,
    action: "DISPUTE_DISMISSED",
    category: "CASE",
    targetType: "DISPUTE",
    targetId: dispute.id,
    targetLabel: dispute.ticketId,
    before: {status: dispute.status, outcome: dispute.outcome},
    after: {status: DISPUTE_STATUS.DISMISSED},
    note: resolution ?? null,
    meta: {type: dispute.type},
  });
};

export {recordDisputeResolved, recordDisputeDismissed};
