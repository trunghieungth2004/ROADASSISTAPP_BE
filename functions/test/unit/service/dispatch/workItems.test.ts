import {
  normalizeWorkItems,
  workItemsTotal,
} from "../../../../service/dispatch/shop/items";

describe("work items", () => {
  it("computes line totals from quantity and unit price", () => {
    const items = normalizeWorkItems([
      {name: "Brake pads", qty: 2, unitPrice: 120000},
      {name: "Labour", qty: 1, unitPrice: 80000},
    ]);
    expect(items).toEqual([
      {name: "Brake pads", qty: 2, unitPrice: 120000, amount: 240000},
      {name: "Labour", qty: 1, unitPrice: 80000, amount: 80000},
    ]);
    expect(workItemsTotal(items)).toBe(320000);
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
