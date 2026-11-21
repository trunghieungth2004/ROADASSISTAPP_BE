import {collectBookings, collectServiceMix} from "../../../service/analyticsMix";

test("service mix counts ticket types, item usage and booking snapshots", () => {
  const mix = collectServiceMix({
    tickets: [
      {
        ticketType: "TOW",
        symptom: "FLAT_TIRE",
        invoiceItems: [
          {serviceCode: "TOW_HOOK", name: "Hook", category: "TOW", qty: 1, amount: 100000},
          {serviceCode: "TOW_KM", name: "Distance", category: "TOW", qty: 3, amount: 60000},
        ],
      },
      {
        ticketType: "SOS",
        symptom: "FLAT_TIRE",
        quoteItems: [
          {serviceCode: "TOW_HOOK", name: "Hook", category: "TOW", qty: 1, amount: 50000},
        ],
      },
    ],
    bookings: [
      {
        serviceSnapshot: [
          {code: "OIL_CHANGE", name: "Oil change", price: 80000},
        ],
      },
      {
        serviceCodes: ["BRAKE_PAD", "OIL_CHANGE"],
      },
    ],
  });
  expect(mix.total).toBe(4);
  expect(mix.byType).toEqual({TOW: 1, SOS: 1});
  expect(mix.byCategory).toEqual({FLAT_TIRE: 2, TOW: 3});
  expect(mix.services.map((row) => [row.key, row.count])).toEqual([
    ["tow_km", 3],
    ["tow_hook", 2],
    ["oil_change", 2],
    ["brake_pad", 1],
  ]);
  expect(mix.topService).toMatchObject({key: "tow_km", count: 3});
});

test("empty service mix has no top service", () => {
  const mix = collectServiceMix({tickets: [], bookings: []});
  expect(mix.total).toBe(0);
  expect(mix.services).toEqual([]);
  expect(mix.topService).toBeNull();
});

test("bookings summarize lifecycle status and service counts", () => {
  const summary = collectBookings([
    {status: "REQUESTED", serviceCodes: ["OIL_CHANGE"]},
    {status: "CONFIRMED", serviceCodes: ["OIL_CHANGE", "BRAKE_PAD"]},
    {status: "COMPLETED", serviceCodes: ["BRAKE_PAD"]},
    {status: "CANCELLED"},
    {status: "DECLINED"},
    {status: "NO_SHOW"},
  ]);
  expect(summary).toMatchObject({
    total: 6,
    active: 2,
    completed: 1,
    cancelled: 1,
    declined: 1,
    noShow: 1,
  });
  expect(summary.byService).toEqual(expect.arrayContaining([
    expect.objectContaining({name: "OIL_CHANGE", count: 2}),
    expect.objectContaining({name: "BRAKE_PAD", count: 2}),
  ]));
});
