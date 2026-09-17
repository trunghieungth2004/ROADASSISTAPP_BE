import {
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import * as serviceAccount from "../config/serviceAccountKey.json";
import {SERVICE_ROLE} from "../constants/status";

const useEmulator = process.env.FUNCTIONS_EMULATOR === "true";
const dryRun = process.argv.includes("--dry-run");
const BATCH_SIZE = 400;

if (getApps().length === 0) {
  if (useEmulator) {
    initializeApp({projectId: process.env.GCLOUD_PROJECT ?? "demo"});
  } else {
    initializeApp({credential: cert({...serviceAccount} as ServiceAccount)});
  }
}

const main = async (): Promise<void> => {
  const db = getFirestore();
  const usersSnap = await db.collection("users").get();
  let batch = db.batch();
  let pending = 0;
  let scanned = 0;
  let updated = 0;
  const grants: Record<string, number> = {};

  const flush = async () => {
    if (pending === 0) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  };

  for (const doc of usersSnap.docs) {
    scanned += 1;
    const data = doc.data() as Record<string, unknown>;
    if (data.status === "0") continue;
    const current = Array.isArray(data.services) ?
      (data.services as string[]) :
      [];
    const next = [...current];
    const add = (license: string) => {
      if (!next.includes(license)) {
        next.push(license);
        grants[license] = (grants[license] ?? 0) + 1;
      }
    };
    add(SERVICE_ROLE.RIDER);
    if (data.volunteerAvailable === true) add(SERVICE_ROLE.VOLUNTEER);

    const shopsSnap = await db
      .collection("shops")
      .where("operatorUid", "==", doc.id)
      .limit(1)
      .get();
    if (!shopsSnap.empty) add(SERVICE_ROLE.SHOP);

    const profilesSnap = await db
      .collection("users")
      .doc(doc.id)
      .collection("vehicle_profiles")
      .where("towVehicleType", "!=", null)
      .limit(1)
      .get();
    if (!profilesSnap.empty) add(SERVICE_ROLE.TOW);

    if (next.length === current.length) continue;
    updated += 1;
    if (dryRun) {
      console.log(
        `${doc.id}: [${current.join(",")}] -> [${next.join(",")}]`,
      );
      continue;
    }
    batch.update(doc.ref, {services: next});
    pending += 1;
    if (pending >= BATCH_SIZE) await flush();
  }
  await flush();
  console.log(
    `backfill-services ${dryRun ? "dry-run" : "done"}: ` +
      `scanned=${scanned} updated=${updated} ` +
      `grants=${JSON.stringify(grants)}`,
  );
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-services failed:", err);
    process.exit(1);
  });
