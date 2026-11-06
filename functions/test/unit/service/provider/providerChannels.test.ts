import {normalizeShopServices} from
  "../../../../service/provider/schedule";

describe("normalizeShopServices channels", () => {
  const base = {
    code: "OIL",
    name: "Oil change",
    displayPrice: 100000,
    quoteRequired: false,
    category: "ENGINE",
  };

  it("defaults legacy services to both channels", () => {
    const rows = normalizeShopServices([base]);
    expect(rows[0]?.channels).toEqual(["BOOKING", "ASSIST"]);
  });

  it("keeps an explicit single channel", () => {
    const rows = normalizeShopServices([
      {...base, channels: ["ASSIST"]},
    ]);
    expect(rows[0]?.channels).toEqual(["ASSIST"]);
  });

  it("rejects an empty channel list", () => {
    expect(() => normalizeShopServices([
      {...base, channels: []},
    ])).toThrow("Service channels are invalid");
  });

  it("rejects unknown channels", () => {
    expect(() => normalizeShopServices([
      {...base, channels: ["WALK_IN"]},
    ])).toThrow("Service channels are invalid");
  });
});
