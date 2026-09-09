import {
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import * as serviceAccount from "../config/serviceAccountKey.json";
import {ROLES} from "../constants/roles";

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
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("db.init failed:", err);
    process.exit(1);
  });
