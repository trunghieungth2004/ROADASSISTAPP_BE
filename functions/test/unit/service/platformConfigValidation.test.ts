import {
  PLATFORM_CONFIG_DEFAULTS,
  REFUND_POLICY,
} from "../../../constants/payments";
import {validatePaymentConfig} from
  "../../../service/platformConfigService";
import type {PlatformConfig} from
  "../../../repository/platformConfigRepository";

const valid = (): PlatformConfig => ({
  ...PLATFORM_CONFIG_DEFAULTS,
  commissionRate: {...PLATFORM_CONFIG_DEFAULTS.commissionRate},
  nightWindow: {...PLATFORM_CONFIG_DEFAULTS.nightWindow},
  paymentMethodsEnabled: [...PLATFORM_CONFIG_DEFAULTS.paymentMethodsEnabled],
  providerPricing: {
    TOW: {...PLATFORM_CONFIG_DEFAULTS.providerPricing.TOW},
    MOBILE_SHOP: {...PLATFORM_CONFIG_DEFAULTS.providerPricing.MOBILE_SHOP},
  },
  waitingGraceMinutes: PLATFORM_CONFIG_DEFAULTS.waitingGraceMin,
  waitingCapMinutes: PLATFORM_CONFIG_DEFAULTS.waitingCapMin,
  waitingBlockMinutes: 15,
});

describe("validatePaymentConfig", () => {
  it("accepts the default card", () => {
    expect(validatePaymentConfig(valid())).toEqual([]);
  });

  it("reports invalid money, rail, and refund keys", () => {
    const config = valid();
    config.commissionRate.TOW = 120;
    config.paymentMethodsEnabled = [];
    config.refundPolicy = "BOGUS";
    config.towBaseFee = -1;
    config.waitingCapMin = 1;
    config.waitingGraceMin = 10;
    expect(validatePaymentConfig(config)).toEqual(expect.arrayContaining([
      "commissionRate.TOW",
      "paymentMethodsEnabled",
      "refundPolicy",
      "towBaseFee",
      "waitingCapMin",
    ]));
  });

  it("rejects inverted provider pricing bounds", () => {
    const config = valid();
    config.providerPricing.TOW.baseMin = 400000;
    config.providerPricing.MOBILE_SHOP.travelPerKmMax = 1000;
    expect(validatePaymentConfig(config)).toEqual(expect.arrayContaining([
      "providerPricing.towBase",
      "providerPricing.travelPerKm",
    ]));
  });

  it("accepts every documented refund policy", () => {
    for (const policy of Object.values(REFUND_POLICY)) {
      const config = valid();
      config.refundPolicy = policy;
      expect(validatePaymentConfig(config)).toEqual([]);
    }
  });
});
