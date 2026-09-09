import {
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import * as serviceAccount from "../config/serviceAccountKey.json";
import {ROLES} from "../constants/roles";
import {STATUS_GROUPS} from "../constants/status";

const useEmulator = process.env.FUNCTIONS_EMULATOR === "true";

if (getApps().length === 0) {
  if (useEmulator) {
    initializeApp({projectId: process.env.GCLOUD_PROJECT ?? "demo"});
  } else {
    initializeApp({credential: cert(serviceAccount as ServiceAccount)});
  }
}

const main = async (): Promise<void> => {
  const db = getFirestore();
  const roles = Object.values(ROLES);
  const batch = db.batch();
  for (const role of roles) {
    batch.set(
      db.collection("roles").doc(role.code),
      {name: role.name, description: role.description},
      {merge: true},
    );
  }
  await batch.commit();
  const codes = roles.map((r) => r.code).join(", ");
  console.log(`Seeded roles collection with codes: ${codes}`);

  const statusBatch = db.batch();
  const statuses = Object.values(STATUS_GROUPS)
    .map((group) => Object.values(group))
    .flat();
  for (const status of statuses) {
    statusBatch.set(
      db.collection("statuses").doc(`${status.domain}:${status.code}`),
      {
        domain: status.domain,
        code: status.code,
        name: status.name,
        description: status.description,
        order: status.order,
      },
      {merge: true},
    );
  }
  await statusBatch.commit();
  const ids = statuses.map((s) => `${s.domain}:${s.code}`).join(", ");
  console.log(`Seeded statuses collection with ids: ${ids}`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("db.init failed:", err);
    process.exit(1);
  });
