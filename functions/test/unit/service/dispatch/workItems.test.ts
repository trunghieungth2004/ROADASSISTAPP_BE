import {
  normalizeWorkItems,
  resolveQuoteAmount,
  workItemsTotal,
} from "../../../../service/dispatch/shop/items";

describe("work items", () => {
  it("computes line totals from quantity and unit price", () => {
    const items = normalizeWorkItems([
      {name: "Brake pads", qty: 2, unitPrice: 120000},
      {name: "Labour", qty: 1, unitPrice: 80000},
    ]);
    expect(items).toMatchObject([
      {name: "Brake pads", qty: 2, unitPrice: 120000, amount: 240000},
      {name: "Labour", qty: 1, unitPrice: 80000, amount: 80000},
    ]);
    expect(workItemsTotal(items)).toBe(320000);
  });

  const catalog = [
    {
      code: "TIRE",
      name: "Flat tire",
      displayPrice: 50000,
      quoteRequired: false,
      category: "FLAT_TIRE",
      warrantyDays: 7,
      warrantyParts: "LABOR_ONLY",
    },
    {
      code: "ENGINE",
      name: "Engine check",
      displayPrice: 200000,
      quoteRequired: true,
      category: "ENGINE",
    },
  ];

  it("links service lines to the catalog and snapshots warranty", () => {
    const [item] = normalizeWorkItems([
      {
        kind: "SERVICE",
        serviceCode: "TIRE",
        name: "ignored",
        qty: 1,
        unitPrice: 50000,
      },
    ], {services: catalog});
    expect(item).toMatchObject({
      kind: "SERVICE",
      serviceCode: "TIRE",
      name: "Flat tire",
      priceMode: "FIXED",
      listPrice: 50000,
      warrantyDays: 7,
      warrantyParts: "LABOR_ONLY",
    });
    expect(item.lineId).toBeTruthy();
  });

  it("rejects a fixed catalog price override", () => {
    expect(() => normalizeWorkItems([
      {
        kind: "SERVICE",
        serviceCode: "TIRE",
        name: "Flat tire",
        qty: 1,
        unitPrice: 40000,
      },
    ], {services: catalog})).toThrow();
  });

  it("allows a quoted inspection service at a custom price", () => {
    const [item] = normalizeWorkItems([
      {
        kind: "SERVICE",
        serviceCode: "ENGINE",
        name: "Engine",
        qty: 1,
        unitPrice: 250000,
      },
    ], {services: catalog});
    expect(item.priceMode).toBe("QUOTED");
    expect(item.unitPrice).toBe(250000);
  });

  it("zeroes every line for a free warranty rework quote", () => {
    const result = resolveQuoteAmount({
      items: [{
        kind: "SERVICE",
        serviceCode: "TIRE",
        name: "Flat tire",
        qty: 1,
        unitPrice: 0,
      }],
      services: catalog,
      free: true,
    });
    expect(result.amount).toBe(0);
    expect(result.workItems).toMatchObject([{
      serviceCode: "TIRE",
      qty: 1,
      unitPrice: 0,
      amount: 0,
    }]);
  });

  it("requires a reason on new extras and caps them at five", () => {
    expect(() => normalizeWorkItems([
      {kind: "EXTRA", name: "Shop supplies", qty: 1, unitPrice: 10000},
    ])).toThrow();
    const extras = Array.from({length: 6}, (_, i) => ({
      kind: "EXTRA",
      name: `Extra ${i}`,
      qty: 1,
      unitPrice: 1000,
      note: "reason",
    }));
    expect(() => normalizeWorkItems(extras)).toThrow();
  });

  it("rejects extras in catalog-only mode", () => {
    expect(() => normalizeWorkItems([
      {
        kind: "EXTRA",
        name: "Shop supplies",
        qty: 1,
        unitPrice: 10000,
        note: "shop",
      },
    ], {catalogOnly: true})).toThrow();
  });

  it("keeps legacy items without a note", () => {
    const [item] = normalizeWorkItems([
      {name: "Legacy line", qty: 1, unitPrice: 10000},
    ]);
    expect(item).toMatchObject({kind: "EXTRA", legacy: true});
  });

  it("rejects empty names, bad quantities, and negative prices", () => {
    expect(() => normalizeWorkItems([{name: "", qty: 1, unitPrice: 1}]))
      .toThrow();
    expect(() => normalizeWorkItems([{name: "Part", qty: 0, unitPrice: 1}]))
      .toThrow();
    expect(() => normalizeWorkItems([{name: "Part", qty: 1, unitPrice: -1}]))
      .toThrow();
  });
});
