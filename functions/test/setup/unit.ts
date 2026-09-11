import {jest} from "@jest/globals";

jest.mock("../../config/firebase", () => {
  const chain = (): unknown => {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get: (_target, prop: string | symbol) => {
        if (prop === "get") {
          return async () => ({exists: false, data: () => ({})});
        }
        if (prop === "getAll") return async () => [];
        if (prop === "where") return () => chain();
        if (prop === "doc") return () => chain();
        if (prop === "collection") return () => chain();
        if (prop === "limit") return () => chain();
        if (prop === "orderBy") return () => chain();
        if (prop === "add") return async () => ({id: "mock-id"});
        if (prop === "set") return async () => undefined;
        if (prop === "update") return async () => undefined;
        if (prop === "delete") return async () => undefined;
        if (prop === "runTransaction") {
          return async (fn: (t: unknown) => unknown) => fn(chain());
        }
        if (prop === "batch") {
          return () => ({
            delete: () => undefined,
            set: () => undefined,
            update: () => undefined,
            commit: async () => undefined,
          });
        }
        return chain();
      },
    };
    return new Proxy({}, handler);
  };
  return {
    db: chain(),
    auth: {
      createUser: async () => ({uid: "mock-uid"}),
      updateUser: async () => ({}),
      verifyIdToken: async () => ({uid: "mock-uid"}),
    },
    storage: {},
    messaging: {
      sendEach: jest.fn(async () => ({
        successCount: 0,
        failureCount: 0,
        responses: [],
      })),
    },
    Timestamp: {
      now: () => ({toDate: () => new Date()}),
      fromDate: (d: Date) => ({toDate: () => d}),
    },
    FieldValue: {
      serverTimestamp: () => ({}),
      increment: () => ({}),
    },
    Filter: {},
  };
});

process.env.ALLOWED_ORIGINS = "";
process.env.GCLOUD_PROJECT = "test-project";
process.env.VALHALLA_URL = "http://localhost:8002";
process.env.CACHE_ENABLED = "false";
