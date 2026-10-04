import Joi from "joi";
import {schemas} from "../../../validation/schemas";

const table = schemas as unknown as Record<string, Joi.ObjectSchema>;

const valid: Record<string, unknown> = {
  register: {
    email: "rider@example.com",
    password: "secret123",
    phone: "+10000000001",
  },
  getOneUser: {},
  updateUserRole: {targetUserId: "u1", role: "1"},
  updateUserTrust: {targetUserId: "u1", trustScore: 60},
  updateUserStatus: {targetUserId: "u1", status: "0"},
  setOnboarded: {service: "VOLUNTEER"},
  updateUserServices: {targetUserId: "u1", grant: ["VOLUNTEER"]},
  updateProfile: {displayName: "New Name"},
  createVehicleProfile: {type: "SCOOTER", baseWidth: 0.7, baseHeight: 1.1},
  addRideConfig: {profileId: "p1", configType: "CARGO"},
  getAllVehicleProfiles: {},
  getAlleySegment: {segmentId: "s1"},
  searchAlleysNear: {lat: 10.7626, lng: 106.6602},
  createAlleySegment: {lat: 10.7626, lng: 106.6602, tier: "TIER2"},
  setPassability: {segmentId: "s1", tier: "TIER1"},
  moderateSegment: {segmentId: "s1"},
  createFlag: {type: "FLOOD", lat: 10.7626, lng: 106.6602},
  moderateFlag: {flagId: "f1", status: "3"},
  getFlagsNear: {lat: 10.7626, lng: 106.6602},
  confirmFlag: {flagId: "f1"},
  getFlagById: {flagId: "f1"},
  denyFlag: {flagId: "f1"},
  unflagFlag: {flagId: "f1"},
  nearLandmarks: {lat: 10.7626, lng: 106.6602},
  createLandmark: {lat: 10.7626, lng: 106.6602, displayLabel: "Gate"},
  matchLandmark: {lat: 10.7626, lng: 106.6602, embedding: [0.1, 0.2]},
  getRoute: {
    originLat: 10.7626,
    originLng: 106.6602,
    destLat: 10.7758,
    destLng: 106.7019,
  },
  saveRoute: {
    originLat: 10.7626,
    originLng: 106.6602,
    destLat: 10.7758,
    destLng: 106.7019,
    geometry: {type: "LineString", coordinates: [[106.6602, 10.7626]]},
  },
  createProvider: {kind: "SHOP", name: "Shop", lat: 10.7626, lng: 106.6602},
  nearProviders: {lat: 10.7626, lng: 106.6602},
  createDiagnostic: {category: "FLAT_TIRE", imagePath: "a.jpg"},
  getDiagnostic: {diagnosticId: "d1"},
  createDispatch: {ticketType: "TOW", lat: 10.7, lng: 106.6},
  getDispatch: {ticketId: "t1"},
  getMyTickets: {},
  updateDispatchStatus: {ticketId: "t1", status: "2"},
  acceptDispatch: {ticketId: "t1"},
  selectDispatch: {ticketId: "t1", shopId: "s1"},
  updateDispatchDestination: {ticketId: "t1", destinationShopId: "s1"},
  nearDispatch: {lat: 10.7, lng: 106.6},
  dispatchOffers: {lat: 10.7, lng: 106.6, kind: "TOW"},
  volunteerToggle: {available: true},
  volunteerHeartbeat: {lat: 10.7, lng: 106.6},
  submitRating: {
    targetId: "vol1",
    targetKind: "VOLUNTEER",
    ticketId: "t1",
    score: 5,
  },
  deliverDispatch: {ticketId: "t1"},
  updateProvider: {providerId: "p1", accepting: false},
  reportProvider: {providerId: "p1", reason: "SPAM"},
  dismissReport: {reportId: "r1"},
  suspendProvider: {providerId: "p1", reason: "spam"},
  restoreProvider: {providerId: "p1"},
  updateProviderLocation: {lat: 10.7, lng: 106.6},
  getRoles: {},
  getRoleByUser: {},
  getStatuses: {},
};

describe("schemas accept valid samples", () => {
  for (const [name, sample] of Object.entries(valid)) {
    it(`${name} passes`, () => {
      const {error} = table[name].validate(sample);
      expect(error).toBeUndefined();
    });
  }
});

describe("schemas reject invalid input", () => {
  it("register rejects bad email and short password", () => {
    expect(
      table.register.validate({email: "nope", password: "secret123"}).error,
    ).toBeDefined();
    expect(
      table.register.validate({email: "a@b.co", password: "123"}).error,
    ).toBeDefined();
    expect(table.register.validate({password: "secret123"}).error)
      .toBeDefined();
  });

  it("updateUserStatus rejects unknown status codes", () => {
    const {error} = table.updateUserStatus.validate({
      targetUserId: "b",
      status: "9",
    });
    expect(error).toBeDefined();
  });

  it("updateUserRole requires target and role", () => {
    expect(table.updateUserRole.validate({role: "1"}).error).toBeDefined();
    expect(
      table.updateUserRole.validate({targetUserId: "u1"}).error,
    ).toBeDefined();
  });

  it("setOnboarded accepts service or legacy role, not neither", () => {
    expect(
      table.setOnboarded.validate({service: "VOLUNTEER"}).error,
    ).toBeUndefined();
    expect(
      table.setOnboarded.validate({role: "VOLUNTEER"}).error,
    ).toBeUndefined();
    expect(
      table.setOnboarded.validate({service: "TOW"}).error,
    ).toBeDefined();
    expect(
      table.setOnboarded.validate({service: "SHOP"}).error,
    ).toBeDefined();
    expect(table.setOnboarded.validate({}).error).toBeDefined();
    expect(
      table.setOnboarded.validate({service: "PILOT"}).error,
    ).toBeDefined();
  });

  it("updateUserServices requires a target plus grant or revoke", () => {
    expect(
      table.updateUserServices.validate({targetUserId: "u1"}).error,
    ).toBeDefined();
    expect(
      table.updateUserServices.validate({grant: ["VOLUNTEER"]}).error,
    ).toBeDefined();
    expect(
      table.updateUserServices.validate(
        {targetUserId: "u1", revoke: ["NOPE"]},
      ).error,
    ).toBeDefined();
  });

  it("createVehicleProfile rejects bad type", () => {
    const {error} = table.createVehicleProfile.validate({
      type: "BOAT",
      baseWidth: 1,
      baseHeight: 1,
    });
    expect(error).toBeDefined();
    expect(
      table.createVehicleProfile.validate({
        type: "CAR",
        baseWidth: 1.9,
        baseHeight: 1.5,
      }).error,
    ).toBeUndefined();
  });

  it("addRideConfig rejects bad configType", () => {
    const {error} = table.addRideConfig.validate({
      profileId: "p1",
      configType: "DUO",
    });
    expect(error).toBeDefined();
  });

  it("createAlleySegment rejects bad tier and out-of-range coords", () => {
    const base = {lat: 10.7, lng: 106.6, tier: "TIER1"};
    expect(
      table.createAlleySegment.validate({...base, tier: "T9"}).error,
    ).toBeDefined();
    expect(
      table.createAlleySegment.validate({...base, lat: 91}).error,
    ).toBeDefined();
    expect(
      table.createAlleySegment.validate({...base, lng: 181}).error,
    ).toBeDefined();
    expect(
      table.createAlleySegment.validate({...base, tier: undefined}).error,
    ).toBeDefined();
  });

  it("setPassability requires segment and tier", () => {
    expect(table.setPassability.validate({tier: "TIER1"}).error).toBeDefined();
    expect(
      table.setPassability.validate({segmentId: "s1"}).error,
    ).toBeDefined();
  });

  it("moderateSegment allows tier and verifiedCount to be omitted", () => {
    const {error} = table.moderateSegment.validate({segmentId: "s1"});
    expect(error).toBeUndefined();
  });

  it("createFlag rejects bad type", () => {
    const {error} = table.createFlag.validate({
      type: "FIRE",
      lat: 10.7,
      lng: 106.6,
    });
    expect(error).toBeDefined();
  });

  it("createFlag accepts an optional radiusMeters within bounds", () => {
    const base = {type: "FLOOD", lat: 10.7, lng: 106.6};
    expect(
      table.createFlag.validate({...base, radiusMeters: 500}).error,
    ).toBeUndefined();
    expect(
      table.createFlag.validate({...base, radiusMeters: 10}).error,
    ).toBeDefined();
    expect(
      table.createFlag.validate({...base, radiusMeters: 5000}).error,
    ).toBeDefined();
    expect(
      table.createFlag.validate({...base, radiusMeters: "far"}).error,
    ).toBeDefined();
  });

  it("unflagFlag requires flagId", () => {
    expect(table.unflagFlag.validate({}).error).toBeDefined();
  });

  it("moderateFlag rejects bad status", () => {
    const {error} = table.moderateFlag.validate({
      flagId: "f1",
      status: "DONE",
    });
    expect(error).toBeDefined();
  });

  it("matchLandmark rejects empty or non-numeric embedding", () => {
    const base = {lat: 10.7, lng: 106.6};
    expect(
      table.matchLandmark.validate({...base, embedding: []}).error,
    ).toBeDefined();
    expect(
      table.matchLandmark.validate({...base, embedding: ["x"]}).error,
    ).toBeDefined();
  });

  it("getRoute requires all coordinates", () => {
    const {error} = table.getRoute.validate({
      originLat: 10.7,
      originLng: 106.6,
      destLat: 10.8,
    });
    expect(error).toBeDefined();
  });

  it("getRoute accepts up to 10 stops and rejects bad ones", () => {
    const base = {
      originLat: 10.7,
      originLng: 106.6,
      destLat: 10.8,
      destLng: 106.7,
    };
    const stop = {lat: 10.75, lng: 106.65};
    expect(
      table.getRoute.validate({...base, stops: [stop]}).error,
    ).toBeUndefined();
    expect(
      table.getRoute.validate({
        ...base,
        stops: Array.from({length: 10}, () => stop),
      }).error,
    ).toBeUndefined();
    expect(
      table.getRoute.validate({
        ...base,
        stops: Array.from({length: 11}, () => stop),
      }).error,
    ).toBeDefined();
    expect(
      table.getRoute.validate({...base, stops: [{lat: 91, lng: 0}]}).error,
    ).toBeDefined();
    expect(
      table.getRoute.validate({...base, stops: "nope"}).error,
    ).toBeDefined();
  });

  it("provider schemas reject bad kind", () => {
    const base = {lat: 10.7, lng: 106.6};
    expect(
      table.createProvider.validate({...base, name: "S", kind: "BAR"}).error,
    ).toBeDefined();
    expect(
      table.nearProviders.validate({...base, kind: "BAR"}).error,
    ).toBeDefined();
    expect(
      table.nearProviders.validate({...base, radiusMeters: 50}).error,
    ).toBeDefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "SHOP",
        openHours: "9-5",
      }).error,
    ).toBeDefined();
    expect(
      table.createProvider.validate({...base, name: "S", kind: "PUMP"}).error,
    ).toBeDefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "TOW",
        plate: "30A12345",
        vehicleType: "BOAT",
      }).error,
    ).toBeDefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "TOW",
        plate: "30A12345",
        vehicleType: "VAN",
        vehicleWidth: 2.0,
      }).error,
    ).toBeUndefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "TOW",
        vehicleType: "VAN",
      }).error,
    ).toBeDefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "SHOP",
        plate: "30A12345",
      }).error,
    ).toBeDefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "SHOP",
        openHours: "MON 08:00-18:00",
      }).error,
    ).toBeUndefined();
    expect(
      table.reviewProvider.validate({providerId: "p1"}).error,
    ).toBeDefined();
    expect(
      table.reviewProvider.validate({providerId: "p1", approve: true}).error,
    ).toBeUndefined();
    expect(
      table.reportProvider.validate({
        providerId: "p1",
        reason: "NOPE",
      }).error,
    ).toBeDefined();
    expect(
      table.reportProvider.validate({
        providerId: "p1",
        reason: "FAKE_BUSINESS",
      }).error,
    ).toBeUndefined();
    expect(
      table.suspendProvider.validate({providerId: "p1"}).error,
    ).toBeUndefined();
    expect(
      table.restoreProvider.validate({}).error,
    ).toBeDefined();
    expect(
      table.updateProviderLocation.validate({lat: 10.7, lng: 106.6}).error,
    ).toBeUndefined();
    expect(
      table.updateProviderLocation.validate({lat: 10.7}).error,
    ).toBeDefined();
  });

  it("dispatch schemas accept the assist flow", () => {
    expect(
      table.createDispatch.validate({
        ticketType: "SOS",
        lat: 10.7,
        lng: 106.6,
        note: "Alley gate",
        destinationShopId: "s1",
      }).error,
    ).toBeUndefined();
    expect(
      table.createDispatch.validate({
        ticketType: "TOW",
        lat: 10.7,
        lng: 106.6,
        destinationPoint: {lat: 10.71, lng: 106.61, label: "Home"},
        vehicleType: "CAR",
        vehicleWidth: 1.9,
      }).error,
    ).toBeUndefined();
    expect(
      table.createDispatch.validate({
        ticketType: "TOW",
        lat: 10.7,
        lng: 106.6,
        vehicleType: "BOAT",
      }).error,
    ).toBeDefined();
    expect(
      table.updateDispatchDestination.validate({
        ticketId: "t1",
        destinationPoint: {lat: 10.71, lng: 106.61, label: "Home"},
      }).error,
    ).toBeUndefined();
    expect(
      table.updateDispatchDestination.validate({
        ticketId: "t1",
      }).error,
    ).toBeUndefined();
    expect(
      table.volunteerToggle.validate({
        available: true,
        capability: "CAR",
      }).error,
    ).toBeUndefined();
    expect(
      table.volunteerToggle.validate({
        available: true,
        capability: "PLANE",
      }).error,
    ).toBeDefined();
    expect(
      table.dispatchOffers.validate({
        lat: 10.7,
        lng: 106.6,
        kind: "TOW",
        accessWidthMeters: 2.5,
      }).error,
    ).toBeUndefined();
    expect(
      table.dispatchOffers.validate({
        lat: 10.7,
        lng: 106.6,
        kind: "MOBILE",
      }).error,
    ).toBeDefined();
    expect(
      table.getRoute.validate({
        originLat: 10.7626,
        originLng: 106.6602,
        destLat: 10.7758,
        destLng: 106.7019,
        vehicleType: "CAR",
      }).error,
    ).toBeUndefined();
    expect(
      table.submitRating.validate({
        targetId: "v",
        targetKind: "RIDER",
        ticketId: "t",
        score: 9,
      }).error,
    ).toBeDefined();
    expect(
      table.volunteerToggle.validate({}).error,
    ).toBeDefined();
  });

  it("createDiagnostic rejects bad category", () => {
    const {error} = table.createDiagnostic.validate({
      category: "ENGINE",
      imagePath: "a.jpg",
    });
    expect(error).toBeDefined();
  });

  it("dispatch schemas reject bad ticketType and status", () => {
    expect(
      table.createDispatch.validate({
        ticketType: "TAXI",
        lat: 10.7,
        lng: 106.6,
      }).error,
    ).toBeDefined();
    expect(
      table.updateDispatchStatus.validate({
        ticketId: "t1",
        status: "FLYING",
      }).error,
    ).toBeDefined();
    expect(table.getDispatch.validate({}).error).toBeDefined();
  });

  it("empty-body schemas accept anything", () => {
    for (const name of [
      "getOneUser",
      "getAllVehicleProfiles",
      "getRoles",
      "getRoleByUser",
    ]) {
      expect(table[name].validate({}).error).toBeUndefined();
      expect(table[name].validate({anything: 1}).error).toBeUndefined();
    }
  });

  it("strips unknown fields when requested", () => {
    const {error, value} = table.searchAlleysNear.validate(
      {lat: 10.7, lng: 106.6, hacker: true},
      {stripUnknown: true},
    );
    expect(error).toBeUndefined();
    expect(value).not.toHaveProperty("hacker");
  });

  it("saveRoute drops legacy via/hazards instead of rejecting them", () => {
    const {error, value} = table.saveRoute.validate(
      {
        originLat: 10.7626,
        originLng: 106.6602,
        destLat: 10.7758,
        destLng: 106.7019,
        geometry: {type: "LineString", coordinates: [[106.6602, 10.7626]]},
        via: null,
        hazards: null,
      },
      {stripUnknown: true},
    );
    expect(error).toBeUndefined();
    expect(value).not.toHaveProperty("via");
    expect(value).not.toHaveProperty("hazards");
  });
});

describe("phase 2 provider schemas", () => {
  const base = {lat: 10.7, lng: 106.6};
  test("vehicleClasses allowed on shops only", () => {
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "SHOP",
        vehicleClasses: ["SOLO_BIKE"],
      }).error,
    ).toBeUndefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "SHOP",
        vehicleClasses: ["PLANE"],
      }).error,
    ).toBeDefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "TOW",
        plate: "30A12345",
        vehicleType: "VAN",
        vehicleClasses: ["CAR"],
      }).error,
    ).toBeDefined();
    expect(
      table.updateProvider.validate({
        providerId: "p1",
        vehicleClasses: ["CAR", "SOLO_BIKE"],
      }).error,
    ).toBeUndefined();
  });
  test("nearProviders accepts a vehicle class", () => {
    expect(
      table.nearProviders.validate({...base, vehicleClass: "CAR"}).error,
    ).toBeUndefined();
    expect(
      table.nearProviders.validate({...base, vehicleClass: "BOAT"}).error,
    ).toBeDefined();
  });
  test("searchProviders requires a query", () => {
    expect(
      table.searchProviders.validate({...base, query: "fix"}).error,
    ).toBeUndefined();
    expect(
      table.searchProviders.validate({...base, query: "  "}).error,
    ).toBeDefined();
    expect(
      table.searchProviders.validate(base).error,
    ).toBeDefined();
  });
  test("INFO_INACCURATE is a valid report reason", () => {
    expect(
      table.reportProvider.validate({
        providerId: "p1",
        reason: "INFO_INACCURATE",
      }).error,
    ).toBeUndefined();
  });
});

describe("phase 6 fee schemas", () => {
  const base = {lat: 10.7, lng: 106.6};
  test("fee fields are kind-scoped", () => {
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "SHOP",
        serviceFee: 150000,
      }).error,
    ).toBeUndefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "SHOP",
        towBaseFee: 1,
      }).error,
    ).toBeDefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "T",
        kind: "TOW",
        plate: "30A12345",
        vehicleType: "VAN",
        towBaseFee: 500000,
        towPerKmFee: 20000,
      }).error,
    ).toBeUndefined();
    expect(
      table.createProvider.validate({
        ...base,
        name: "T",
        kind: "TOW",
        plate: "30A12345",
        vehicleType: "VAN",
        serviceFee: 1,
      }).error,
    ).toBeDefined();
  });
  test("work order amounts are integer VND", () => {
    expect(
      table.updateWorkOrder.validate({
        ticketId: "t1",
        quotedAmount: 400000,
      }).error,
    ).toBeUndefined();
    expect(
      table.updateWorkOrder.validate({
        ticketId: "t1",
        quotedAmount: 400.5,
      }).error,
    ).toBeDefined();
    expect(
      table.updateWorkOrder.validate({
        ticketId: "t1",
        finalAmount: -1,
      }).error,
    ).toBeDefined();
  });
  test("decline and shop-ticket schemas", () => {
    expect(
      table.declineDispatch.validate({
        ticketId: "t1",
        shopId: "s1",
        reason: "FULL",
      }).error,
    ).toBeUndefined();
    expect(
      table.declineDispatch.validate({ticketId: "t1", shopId: "s1"}).error,
    ).toBeDefined();
    expect(
      table.shopTickets.validate({shopId: "s1", limit: 5}).error,
    ).toBeUndefined();
    expect(
      table.searchProviders.validate({lat: 1, lng: 2, query: "x"}).error,
    ).toBeUndefined();
    expect(
      table.feedTickets.validate({}).error,
    ).toBeUndefined();
    expect(
      table.feedTickets.validate({limit: 10}).error,
    ).toBeUndefined();
    expect(
      table.feedTickets.validate({limit: 500}).error,
    ).toBeDefined();
    expect(
      table.ratingsByTicket.validate({ticketId: "t1"}).error,
    ).toBeUndefined();
    expect(
      table.ratingsByTicket.validate({}).error,
    ).toBeDefined();
  });
});

describe("hardening schemas", () => {
  test("decline requires a known reason", () => {
    expect(
      table.declineDispatch.validate({
        ticketId: "t1",
        shopId: "s1",
        reason: "FULL",
      }).error,
    ).toBeUndefined();
    expect(
      table.declineDispatch.validate({ticketId: "t1", shopId: "s1"}).error,
    ).toBeDefined();
    expect(
      table.declineDispatch.validate({
        ticketId: "t1",
        shopId: "s1",
        reason: "LATER",
      }).error,
    ).toBeDefined();
  });
  test("user ratings scope to people targets", () => {
    expect(
      table.userRatings.validate({
        userId: "u1",
        targetKind: "RIDER",
        ticketId: "t1",
      }).error,
    ).toBeUndefined();
    expect(
      table.userRatings.validate({
        userId: "s1",
        targetKind: "SHOP",
        ticketId: "t1",
      }).error,
    ).toBeDefined();
  });
  test("fees and amounts are bounded integers", () => {
    const base = {lat: 10.7, lng: 106.6};
    expect(
      table.createProvider.validate({
        ...base,
        name: "S",
        kind: "SHOP",
        serviceFee: 1000000000,
      }).error,
    ).toBeDefined();
    expect(
      table.updateWorkOrder.validate({
        ticketId: "t1",
        quotedAmount: 1000000000,
      }).error,
    ).toBeDefined();
  });
});
