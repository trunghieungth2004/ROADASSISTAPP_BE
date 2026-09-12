import {
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import * as serviceAccount from "../config/serviceAccountKey.json";
import * as shopRepository from "../repository/shopRepository";
import * as landmarkRepository from "../repository/landmarkRepository";

const useEmulator = process.env.FUNCTIONS_EMULATOR === "true";

if (getApps().length === 0) {
  if (useEmulator) {
    initializeApp({projectId: process.env.GCLOUD_PROJECT ?? "demo"});
  } else {
    initializeApp({credential: cert({...serviceAccount} as ServiceAccount)});
  }
}

const SHOPS = [
  {name: "Demo Moto Repair Ben Thanh", lat: 10.7725, lng: 106.698,
    type: "SHOP"},
  {name: "Demo Moto Repair Cho Lon", lat: 10.7498, lng: 106.652,
    type: "SHOP"},
  {name: "Demo Fuel Stop District 3", lat: 10.7821, lng: 106.6775,
    type: "PUMP"},
  {name: "Demo Tire Fix Phu Nhuan", lat: 10.7984, lng: 106.68,
    type: "SHOP"},
  {name: "Demo Moto Repair Thu Duc", lat: 10.8701, lng: 106.803,
    type: "SHOP"},
];

const LANDMARKS = [
  {displayLabel: "Demo Landmark Ben Thanh Market", lat: 10.772,
    lng: 106.6983},
  {displayLabel: "Demo Landmark Reunification Palace", lat: 10.7798,
    lng: 106.695},
];

const main = async (): Promise<void> => {
  getFirestore();
  for (const shop of SHOPS) {
    const created = await shopRepository.create(shop);
    console.log(`Seeded shop ${created.id} (${shop.name})`);
  }
  for (const landmark of LANDMARKS) {
    const created = await landmarkRepository.create(landmark);
    console.log(`Seeded landmark ${created.id} (${landmark.displayLabel})`);
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed-places failed:", err);
    process.exit(1);
  });
