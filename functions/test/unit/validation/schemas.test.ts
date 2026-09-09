import Joi from "joi";
import {schemas} from "../../../validation/schemas";

const table = schemas as unknown as Record<string, Joi.ObjectSchema>;

const valid: Record<string, unknown> = {
  register: {email: "rider@example.com", password: "secret123"},
  getOneUser: {userId: "u1"},
  updateUserRole: {userId: "admin", targetUserId: "u1", role: "1"},
  updateUserTrust: {userId: "admin", targetUserId: "u1", trustScore: 60},
  updateUserStatus: {userId: "admin", targetUserId: "u1", status: false},
  createVehicleProfile: {
    userId: "u1",
    type: "SCOOTER",
    baseWidth: 0.7,
    baseHeight: 1.1,
  },
  addRideConfig: {userId: "u1", profileId: "p1", configType: "CARGO"},
  getAllVehicleProfiles: {userId: "u1"},
  getAlleySegment: {userId: "u1", segmentId: "s1"},
  searchAlleysNear: {userId: "u1", lat: 10.7626, lng: 106.6602},
  createAlleySegment: {
    userId: "u1",
    lat: 10.7626,
    lng: 106.6602,
    tier: "TIER2",
  },
  setPassability: {userId: "u1", segmentId: "s1", tier: "TIER1"},
  moderateSegment: {userId: "admin", segmentId: "s1"},
  createFlag: {userId: "u1", type: "FLOOD", lat: 10.7626, lng: 106.6602},
  moderateFlag: {userId: "admin", flagId: "f1", status: "LOCKED"},
  getFlagsNear: {userId: "u1", lat: 10.7626, lng: 106.6602},
  confirmFlag: {userId: "u1", flagId: "f1"},
  nearLandmarks: {userId: "u1", lat: 10.7626, lng: 106.6602},
  createLandmark: {
    userId: "u1",
    lat: 10.7626,
    lng: 106.6602,
    displayLabel: "Gate",
  },
  matchLandmark: {
    userId: "u1",
    lat: 10.7626,
    lng: 106.6602,
    embedding: [0.1, 0.2],
  },
  getRoute: {
    userId: "u1",
    originLat: 10.7626,
    originLng: 106.6602,
    destLat: 10.7758,
    destLng: 106.7019,
  },
  createShop: {
    userId: "u1",
    name: "Shop",
    lat: 10.7626,
    lng: 106.6602,
    type: "SHOP",
  },
  nearShops: {userId: "u1", lat: 10.7626, lng: 106.6602},
  createDiagnostic: {userId: "u1", category: "FLAT_TIRE", imagePath: "a.jpg"},
  getDiagnostic: {userId: "u1", diagnosticId: "d1"},
  createDispatch: {userId: "u1", ticketType: "TOW", lat: 10.7, lng: 106.6},
  getDispatch: {userId: "u1", ticketId: "t1"},
  updateDispatchStatus: {userId: "u1", ticketId: "t1", status: "MATCHED"},
  getRoles: {},
  getRoleByUser: {userId: "u1"},
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

  it("updateUserStatus rejects non-boolean status", () => {
    const {error} = table.updateUserStatus.validate({
      userId: "a",
      targetUserId: "b",
      status: "yes",
    });
    expect(error).toBeDefined();
  });

  it("createVehicleProfile rejects bad type", () => {
    const {error} = table.createVehicleProfile.validate({
      userId: "u1",
      type: "TRUCK",
      baseWidth: 1,
      baseHeight: 1,
    });
    expect(error).toBeDefined();
  });

  it("addRideConfig rejects bad configType", () => {
    const {error} = table.addRideConfig.validate({
      userId: "u1",
      profileId: "p1",
      configType: "DUO",
    });
    expect(error).toBeDefined();
  });

  it("createAlleySegment rejects bad tier and out-of-range coords", () => {
    const base = {userId: "u1", lat: 10.7, lng: 106.6, tier: "TIER1"};
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

  it("setPassability requires tier", () => {
    const {error} = table.setPassability.validate({
      userId: "u1",
      segmentId: "s1",
    });
    expect(error).toBeDefined();
  });

  it("moderateSegment allows tier and verifiedCount to be omitted", () => {
    const {error} = table.moderateSegment.validate({
      userId: "a",
      segmentId: "s1",
    });
    expect(error).toBeUndefined();
  });

  it("createFlag rejects bad type", () => {
    const {error} = table.createFlag.validate({
      userId: "u1",
      type: "FIRE",
      lat: 10.7,
      lng: 106.6,
    });
    expect(error).toBeDefined();
  });

  it("moderateFlag rejects bad status", () => {
    const {error} = table.moderateFlag.validate({
      userId: "a",
      flagId: "f1",
      status: "DONE",
    });
    expect(error).toBeDefined();
  });

  it("matchLandmark rejects empty or non-numeric embedding", () => {
    const base = {userId: "u1", lat: 10.7, lng: 106.6};
    expect(
      table.matchLandmark.validate({...base, embedding: []}).error,
    ).toBeDefined();
    expect(
      table.matchLandmark.validate({...base, embedding: ["x"]}).error,
    ).toBeDefined();
  });

  it("getRoute requires all coordinates", () => {
    const {error} = table.getRoute.validate({
      userId: "u1",
      originLat: 10.7,
      originLng: 106.6,
      destLat: 10.8,
    });
    expect(error).toBeDefined();
  });

  it("shop schemas reject bad type", () => {
    const base = {userId: "u1", lat: 10.7, lng: 106.6};
    expect(
      table.createShop.validate({...base, name: "S", type: "BAR"}).error,
    ).toBeDefined();
    expect(
      table.nearShops.validate({...base, type: "BAR"}).error,
    ).toBeDefined();
  });

  it("createDiagnostic rejects bad category", () => {
    const {error} = table.createDiagnostic.validate({
      userId: "u1",
      category: "ENGINE",
      imagePath: "a.jpg",
    });
    expect(error).toBeDefined();
  });

  it("dispatch schemas reject bad ticketType and status", () => {
    expect(
      table.createDispatch.validate({
        userId: "u1",
        ticketType: "TAXI",
        lat: 10.7,
        lng: 106.6,
      }).error,
    ).toBeDefined();
    expect(
      table.updateDispatchStatus.validate({
        userId: "u1",
        ticketId: "t1",
        status: "FLYING",
      }).error,
    ).toBeDefined();
    expect(
      table.getDispatch.validate({userId: "u1"}).error,
    ).toBeDefined();
  });

  it("getRoles allows an empty body and unknown fields", () => {
    expect(table.getRoles.validate({}).error).toBeUndefined();
    expect(table.getRoles.validate({anything: 1}).error).toBeUndefined();
  });

  it("userId lookups require userId", () => {
    expect(table.getOneUser.validate({}).error).toBeDefined();
    expect(table.getRoleByUser.validate({}).error).toBeDefined();
  });

  it("strips unknown fields when requested", () => {
    const {error, value} = table.searchAlleysNear.validate(
      {userId: "u1", lat: 10.7, lng: 106.6, hacker: true},
      {stripUnknown: true},
    );
    expect(error).toBeUndefined();
    expect(value).not.toHaveProperty("hacker");
  });
});
