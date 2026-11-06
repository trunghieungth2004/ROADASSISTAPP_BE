import {initializeApp as initAdmin} from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  FieldValue,
  Filter,
} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {getMessaging} from "firebase-admin/messaging";
import {getStorage} from "firebase-admin/storage";
const useEmulator = process.env.FUNCTIONS_EMULATOR === "true";
initAdmin(
  useEmulator ? {projectId: process.env.GCLOUD_PROJECT ?? "demo"} : {},
);
const db = getFirestore();
const auth = getAuth();
const messaging = getMessaging();
const storage = getStorage();

export {db, auth, messaging, storage, Timestamp, FieldValue, Filter};
