import * as disputeRepository from "../../repository/disputeRepository";

type BillDispute = {
  id: string;
  status: string;
  type: string;
  reasonCode: string;
  outcome: string | null;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

type BillDisputeHistoryRow = {
  id: string;
  status: string;
  type: string;
  reasonCode: string;
  outcome: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

const disputeSummaryFrom = (
  rows: disputeRepository.Dispute[],
): BillDispute | null => {
  if (rows.length === 0) return null;
  const row = rows.find((item) => item.status === "OPEN") ?? rows[0];
  return {
    id: row.id,
    status: row.status,
    type: row.type,
    reasonCode: row.reasonCode,
    outcome: row.outcome ?? null,
    resolution: row.resolution ?? null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
  };
};

const disputeHistoryFrom = (
  rows: disputeRepository.Dispute[],
): BillDisputeHistoryRow[] => rows.map((row) => ({
  id: row.id,
  status: row.status,
  type: row.type,
  reasonCode: row.reasonCode,
  outcome: row.outcome ?? null,
  createdAt: row.createdAt,
  resolvedAt: row.resolvedAt ?? null,
}));

export {
  disputeSummaryFrom,
  disputeHistoryFrom,
  BillDispute,
  BillDisputeHistoryRow,
};
