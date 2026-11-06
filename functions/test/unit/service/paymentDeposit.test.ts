import {depositCreditFor} from
  "../../../service/payment/depositCredit";

describe("depositCreditFor", () => {
  it("counts collected cash", () => {
    expect(depositCreditFor({
      depositAmount: 200000,
      depositStatus: "COLLECTED",
    })).toBe(200000);
  });

  it("counts a confirmed online deposit", () => {
    expect(depositCreditFor({
      depositAmount: 150000,
      depositStatus: "CONFIRMED",
    })).toBe(150000);
  });

  it("does not count a requested deposit", () => {
    expect(depositCreditFor({
      depositAmount: 150000,
      depositStatus: "REQUESTED",
    })).toBe(0);
  });

  it("does not count a waived deposit", () => {
    expect(depositCreditFor({
      depositAmount: 150000,
      depositStatus: "WAIVED",
    })).toBe(0);
  });

  it("ignores a missing amount", () => {
    expect(depositCreditFor({depositStatus: "CONFIRMED"})).toBe(0);
  });
});
