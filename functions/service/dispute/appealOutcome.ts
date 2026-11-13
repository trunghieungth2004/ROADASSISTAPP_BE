import * as disputeRepository from "../../repository/disputeRepository";
import * as dispatchRepository from "../../repository/dispatchRepository";
import {DISPUTE_OUTCOME, DISPUTE_STATUS} from "../../constants/disputes";
import {NotFoundError, ValidationError} from "../../utils/errors";
import {applyDisputeOutcome} from "../disputeService";

const applyAppealOutcome = async (input: {
  disputeId: string;
  outcome: string;
  adjustedAmount?: number;
  resolution: string;
  by: string;
}): Promise<disputeRepository.Dispute | null> => {
  const dispute = await disputeRepository.findById(input.disputeId);
  if (!dispute) throw new NotFoundError("Dispute not found");
  if (!(Object.values(DISPUTE_OUTCOME) as string[]).includes(input.outcome)) {
    throw new ValidationError("Unknown dispute outcome");
  }
  if (input.outcome === DISPUTE_OUTCOME.PARTIAL &&
    typeof input.adjustedAmount !== "number") {
    throw new ValidationError("Partial resolution needs adjustedAmount");
  }
  const ticket = await dispatchRepository.findById(dispute.ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const resolvedAt = new Date().toISOString();
  await disputeRepository.update(input.disputeId, {
    status: DISPUTE_STATUS.RESOLVED,
    outcome: input.outcome,
    resolution: input.resolution,
    resolvedBy: input.by,
    resolvedAt,
    ...(typeof input.adjustedAmount === "number" ?
      {adjustedAmount: input.adjustedAmount} :
      {}),
  });
  const updated = await disputeRepository.findById(input.disputeId);
  if (!updated) throw new NotFoundError("Dispute not found");
  await applyDisputeOutcome({
    ticket,
    outcome: input.outcome,
    ...(typeof input.adjustedAmount === "number" ?
      {adjustedAmount: input.adjustedAmount} :
      {}),
    resolution: input.resolution,
    by: input.by,
    dispute: updated,
  });
  return updated;
};

export {applyAppealOutcome};
