import Joi from "joi";
import {schemas} from "../../../validation/schemas";

const table = schemas as unknown as Record<string, Joi.ObjectSchema>;

const valid: Record<string, unknown> = {
  register: {email: "rider@example.com", password: "secret123"},
  getOneUser: {},
  updateUserRole: {targetUserId: "u1", role: "1"},
  updateUserTrust: {targetUserId: "u1", trustScore: 60},
  updateUserStatus: {targetUserId: "u1", status: "0"},
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
  createShop: {name: "Shop", lat: 10.7626, lng: 106.6602, type: "SHOP"},
  nearShops: {lat: 10.7626, lng: 106.6602},
  createDiagnostic: {category: "FLAT_TIRE", imagePath: "a.jpg"},
  getDiagnostic: {diagnosticId: "d1"},
  createDispatch: {ticketType: "TOW", lat: 10.7, lng: 106.6},
  getDispatch: {ticketId: "t1"},
  updateDispatchStatus: {ticketId: "t1", status: "2"},
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

  it("createVehicleProfile rejects bad type", () => {
    const {error} = table.createVehicleProfile.validate({
      type: "TRUCK",
      baseWidth: 1,
      baseHeight: 1,
    });
    expect(error).toBeDefined();
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

  it("shop schemas reject bad type", () => {
    const base = {lat: 10.7, lng: 106.6};
    expect(
      table.createShop.validate({...base, name: "S", type: "BAR"}).error,
    ).toBeDefined();
    expect(
      table.nearShops.validate({...base, type: "BAR"}).error,
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
});
