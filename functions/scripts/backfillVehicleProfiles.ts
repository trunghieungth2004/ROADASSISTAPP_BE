import {db} from "../config/firebase";
import {normalizeTowPlate, type Provider} from
  "../repository/providerRepository";

type Row = Provider & {id: string};

const run = async (): Promise<void> => {
  const snap = await db.collection("providers").get();
  const groups = new Map<string, Row[]>();
  snap.forEach((doc) => {
    const row = {id: doc.id, ...doc.data()} as Row;
    const plate = typeof row.plate === "string" ?
      normalizeTowPlate(row.plate) :
      "";
    if (plate === "") return;
    const key = `${String(row.operatorUid ?? "")}:${plate}`;
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  });
  let updated = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const canonical = rows.find((row) =>
      row.kind === "TOW" &&
      typeof row.vehicleProfileId === "string" &&
      row.vehicleProfileId !== "") ??
      rows.find((row) =>
        typeof row.vehicleProfileId === "string" &&
        row.vehicleProfileId !== "");
    if (!canonical || typeof canonical.vehicleProfileId !== "string") {
      continue;
    }
    for (const row of rows) {
      if (row.kind === "MOBILE_SHOP" && row.vehicleType === "BIKE") {
        continue;
      }
      if (row.vehicleProfileId === canonical.vehicleProfileId) continue;
      await db.collection("providers").doc(row.id).update({
        vehicleProfileId: canonical.vehicleProfileId,
      });
      updated += 1;
      console.log(
        `linked ${row.id} (${row.kind}) -> ${canonical.vehicleProfileId}`,
      );
    }
  }
  console.log(`updated ${updated} provider(s)`);
};

void run().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
