import {db} from "../config/firebase";

const COMMISSION_COLLECTION = "commission_ledger";

const run = async (): Promise<void> => {
  const dryRun = process.env.DRY_RUN === "true";
  const payments = await db.collection("payments").get();
  let created = 0;
  let settled = 0;
  for (const doc of payments.docs) {
    const payment = {id: doc.id, ...doc.data()} as Record<string, unknown>;
    if (payment.method !== "CASH" || payment.status !== "CONFIRMED") {
      continue;
    }
    const commission = typeof payment.commissionAmount === "number" ?
      payment.commissionAmount :
      0;
    if (commission <= 0) continue;
    const existing = await db
      .collection(COMMISSION_COLLECTION)
      .where("paymentId", "==", payment.id)
      .limit(1)
      .get();
    if (!existing.empty) continue;
    const now = new Date().toISOString();
    const payoutAt = typeof payment.payoutAt === "string" ?
      payment.payoutAt :
      "";
    const payoutBatchId = typeof payment.payoutBatchId === "string" ?
      payment.payoutBatchId :
      "";
    const ref = db.collection(COMMISSION_COLLECTION).doc();
    const row = {
      payeeId: String(payment.payeeId ?? ""),
      ticketId: String(payment.ticketId ?? ""),
      paymentId: String(payment.id),
      amount: commission,
      settledAmount: payoutAt === "" ? 0 : commission,
      reversedAmount: 0,
      status: payoutAt === "" ? "OWED" : "SETTLED",
      createdAt: now,
      settledAt: payoutAt === "" ? null : payoutAt,
      settledBy: payoutAt === "" ? null : "backfill",
      payoutBatchId: payoutBatchId === "" ? null : payoutBatchId,
    };
    if (!dryRun) {
      await ref.set(row);
    }
    created += 1;
    if (payoutAt !== "") settled += 1;
  }
  console.log(
    `${dryRun ? "[dry-run] " : ""}created ${created} ledger row(s), ` +
    `${settled} marked settled from existing payouts`,
  );
};

void run().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
