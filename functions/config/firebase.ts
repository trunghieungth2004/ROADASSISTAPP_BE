import {
  initializeApp as initAdmin,
  cert,
  ServiceAccount,
} from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  FieldValue,
  Filter,
} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {getStorage} from "firebase-admin/storage";
import * as serviceAccount from "./serviceAccountKey.json";

const useEmulator = process.env.FUNCTIONS_EMULATOR === "true";
initAdmin(
  useEmulator ? {credential: cert(serviceAccount as ServiceAccount)} : {},
);
const db = getFirestore();
const auth = getAuth();
const storage = getStorage();

export {db, auth, storage, Timestamp, FieldValue, Filter};
