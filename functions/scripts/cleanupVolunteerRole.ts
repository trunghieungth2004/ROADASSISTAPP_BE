import {db, FieldValue} from "../config/firebase";

const run = async (): Promise<void> => {
  const users = await db.collection("users").get();
  let updated = 0;
  for (const doc of users.docs) {
    const data = doc.data();
    const services = Array.isArray(data.services) ?
      data.services.filter((service) => service !== "VOLUNTEER") :
      [];
    const hadVolunteer = Array.isArray(data.services) &&
      data.services.includes("VOLUNTEER");
    const hasFields = "volunteerAvailable" in data ||
      "volunteerRadiusKm" in data ||
      "capability" in data;
    if (!hadVolunteer && !hasFields) continue;
    await doc.ref.update({
      services,
      volunteerAvailable: FieldValue.delete(),
      volunteerRadiusKm: FieldValue.delete(),
      capability: FieldValue.delete(),
    });
    updated += 1;
  }
  let locations = 0;
  for (;;) {
    const snap = await db.collection("volunteer_locations").limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    locations += snap.size;
  }
  console.log(`cleaned ${updated} user(s), deleted ${locations} location(s)`);
};

void run().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
