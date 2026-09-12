import {
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import * as serviceAccount from "../config/serviceAccountKey.json";

const useEmulator = process.env.FUNCTIONS_EMULATOR === "true";

if (getApps().length === 0) {
  if (useEmulator) {
    initializeApp({projectId: process.env.GCLOUD_PROJECT ?? "demo"});
  } else {
    initializeApp({credential: cert({...serviceAccount} as ServiceAccount)});
  }
}

const backfill = async (
  collection: string,
  field: string,
  normalized: string,
): Promise<number> => {
  const db = getFirestore();
  const snapshot = await db.collection(collection).get();
  let fixed = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (typeof data[normalized] === "string" && data[normalized] !== "") {
      continue;
    }
    const raw = data[field];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    await doc.ref.update({[normalized]: raw.trim().toLowerCase()});
    fixed += 1;
  }
  return fixed;
};

const main = async (): Promise<void> => {
  const shops = await backfill("shops", "name", "nameLower");
  console.log(`Backfilled nameLower on ${shops} shop(s)`);
  const landmarks = await backfill(
    "landmarks",
    "displayLabel",
    "displayLabelLower",
  );
  console.log(`Backfilled displayLabelLower on ${landmarks} landmark(s)`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-place-names failed:", err);
    process.exit(1);
  });
