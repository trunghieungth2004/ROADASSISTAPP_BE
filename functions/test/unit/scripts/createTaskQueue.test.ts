const mockCloudTasksCtor = jest.fn();

jest.mock("@google-cloud/tasks", () => ({
  CloudTasksClient: mockCloudTasksCtor,
}));

import {
  DISPATCH_QUEUE_NAME,
  ensureQueue,
  QUEUE_NAME,
  RETRY_CONFIG,
} from "../../../scripts/createTaskQueue";

type FakeClient = {
  locationPath: jest.Mock;
  createQueue: jest.Mock;
  getQueue: jest.Mock;
  updateQueue: jest.Mock;
};

const grpcError = (code: number): Error & {code: number} =>
  Object.assign(new Error(`grpc ${code}`), {code});

const fakeClient = (overrides: Partial<FakeClient> = {}): FakeClient => ({
  locationPath: jest.fn(
    (project: string, location: string) =>
      `projects/${project}/locations/${location}`,
  ),
  createQueue: jest.fn(async () => ({})),
  getQueue: jest.fn(async () => []),
  updateQueue: jest.fn(async () => ({})),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("createTaskQueue.ensureQueue", () => {
  it("creates the queue with the push retry policy", async () => {
    const client = fakeClient();
    mockCloudTasksCtor.mockImplementation(() => client as never);
    await expect(
      ensureQueue("proj", "asia-southeast1", QUEUE_NAME),
    ).resolves.toBe(
      "projects/proj/locations/asia-southeast1/queues/hazard-push",
    );
    expect(client.createQueue).toHaveBeenCalledWith({
      parent: "projects/proj/locations/asia-southeast1",
      queue: {
        name: "projects/proj/locations/asia-southeast1/queues/hazard-push",
        retryConfig: RETRY_CONFIG,
      },
    });
    expect(client.getQueue).not.toHaveBeenCalled();
    expect(client.updateQueue).not.toHaveBeenCalled();
  });

  it("converges a stale retry policy on existing queues", async () => {
    const client = fakeClient({
      createQueue: jest.fn(async () => {
        throw grpcError(6);
      }),
      getQueue: jest.fn(async () => [{retryConfig: {maxAttempts: 100}}]),
    });
    mockCloudTasksCtor.mockImplementation(() => client as never);
    await expect(
      ensureQueue("proj", "asia-southeast1", DISPATCH_QUEUE_NAME),
    ).resolves.toBe(
      "projects/proj/locations/asia-southeast1/queues/dispatch-push",
    );
    expect(client.updateQueue).toHaveBeenCalledWith({
      queue: {
        name: "projects/proj/locations/asia-southeast1/queues/dispatch-push",
        retryConfig: RETRY_CONFIG,
      },
      updateMask: {paths: ["retry_config"]},
    });
  });

  it("leaves a current retry policy alone", async () => {
    const client = fakeClient({
      createQueue: jest.fn(async () => {
        throw grpcError(6);
      }),
      getQueue: jest.fn(async () => [{retryConfig: RETRY_CONFIG}]),
    });
    mockCloudTasksCtor.mockImplementation(() => client as never);
    await ensureQueue("proj", "asia-southeast1", QUEUE_NAME);
    expect(client.updateQueue).not.toHaveBeenCalled();
  });

  it("throws without a project", async () => {
    await expect(ensureQueue("", "asia-southeast1")).rejects.toThrow(
      "Set GCLOUD_PROJECT before creating the queue",
    );
  });

  it("rethrows unexpected creation errors", async () => {
    const client = fakeClient({
      createQueue: jest.fn(async () => {
        throw grpcError(13);
      }),
    });
    mockCloudTasksCtor.mockImplementation(() => client as never);
    await expect(
      ensureQueue("proj", "asia-southeast1"),
    ).rejects.toThrow("grpc 13");
    expect(client.updateQueue).not.toHaveBeenCalled();
  });
});
