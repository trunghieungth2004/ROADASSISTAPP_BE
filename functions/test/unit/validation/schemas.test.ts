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
  updateUserServices: {targetUserId: "u1", grant: ["SHOP"]},
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
  createShop: {name: "Shop", lat: 10.7626, lng: 106.6602, type: "SHOP"},
  nearShops: {lat: 10.7626, lng: 106.6602},
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
  setTowVehicle: {profileId: "p1", towVehicleType: "CAR"},
  submitRating: {
    targetId: "vol1",
    targetKind: "VOLUNTEER",
    ticketId: "t1",
    score: 5,
  },
  deliverDispatch: {ticketId: "t1"},
  updateShop: {shopId: "s1", accepting: false},
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
      table.setOnboarded.validate({service: "TOW"}).error,
    ).toBeUndefined();
    expect(
      table.setOnboarded.validate({role: "TOW"}).error,
    ).toBeUndefined();
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
      table.updateUserServices.validate({grant: ["SHOP"]}).error,
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

  it("shop schemas reject bad type", () => {
    const base = {lat: 10.7, lng: 106.6};
    expect(
      table.createShop.validate({...base, name: "S", type: "BAR"}).error,
    ).toBeDefined();
    expect(
      table.nearShops.validate({...base, type: "BAR"}).error,
    ).toBeDefined();
    expect(
      table.nearShops.validate({...base, radiusMeters: 50}).error,
    ).toBeDefined();
    expect(
      table.createShop.validate({
        ...base,
        name: "S",
        type: "TOW",
        openHours: "9-5",
      }).error,
    ).toBeDefined();
    expect(
      table.createShop.validate({...base, name: "S", type: "PUMP"}).error,
    ).toBeDefined();
    expect(
      table.createShop.validate({
        ...base,
        name: "S",
        type: "TOW",
        towVehicleType: "BOAT",
      }).error,
    ).toBeDefined();
    expect(
      table.createShop.validate({
        ...base,
        name: "S",
        type: "MOBILE",
        towVehicleType: "VAN",
        towVehicleWidth: 2.0,
      }).error,
    ).toBeUndefined();
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
        kind: "MOBILE",
        accessWidthMeters: 2.5,
      }).error,
    ).toBeUndefined();
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
