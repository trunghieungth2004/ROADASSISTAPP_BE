jest.mock("@google-cloud/tasks", () => ({
  CloudTasksClient: jest.fn(),
}));

import {CloudTasksClient} from "@google-cloud/tasks";
import {enqueueHazardPush} from "../../../service/taskQueueService";

const OLD_ENV = {...process.env};

let createTask: jest.Mock;
let queuePath: jest.Mock;
let taskPath: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {...OLD_ENV};
  delete process.env.CLOUD_TASKS_ENABLED;
  createTask = jest.fn(async () => ({}));
  queuePath = jest.fn(
    (project: string, location: string, queue: string) =>
      `${project}/${location}/${queue}`,
  );
  taskPath = jest.fn(
    (project: string, location: string, queue: string, id: string) =>
      `${project}/${location}/${queue}/${id}`,
  );
  (CloudTasksClient as unknown as jest.Mock).mockImplementation(() => ({
    queuePath,
    taskPath,
    createTask,
  }));
});

afterAll(() => {
  process.env = OLD_ENV;
});

const enable = () => {
  process.env.CLOUD_TASKS_ENABLED = "true";
  process.env.PUSH_DELIVER_URL = "https://example.com/push/deliver";
  process.env.TASK_INVOKER_EMAIL = "sa@test-project.iam.gserviceaccount.com";
};

describe("taskQueueService.enqueueHazardPush", () => {
  it("stays idle when the queue is disabled", async () => {
    await expect(
      enqueueHazardPush("f1", "FLOOD", "2"),
    ).resolves.toEqual({enqueued: false});
    expect(CloudTasksClient).not.toHaveBeenCalled();
  });

  it("stays idle for non-blocking types", async () => {
    enable();
    await expect(
      enqueueHazardPush("f1", "POTHOLE", "2"),
    ).resolves.toEqual({enqueued: false});
    expect(CloudTasksClient).not.toHaveBeenCalled();
  });

  it("stays idle when delivery config is missing", async () => {
    process.env.CLOUD_TASKS_ENABLED = "true";
    await expect(
      enqueueHazardPush("f1", "FLOOD", "2"),
    ).resolves.toEqual({enqueued: false});
    expect(CloudTasksClient).not.toHaveBeenCalled();
  });

  it("creates a dedup-named task when enabled", async () => {
    enable();
    await expect(
      enqueueHazardPush("f1", "FLOOD", "2"),
    ).resolves.toEqual({enqueued: true});
    expect(queuePath).toHaveBeenCalledWith(
      "test-project",
      "asia-southeast1",
      "hazard-push",
    );
    expect(createTask).toHaveBeenCalledTimes(1);
    const {task} = createTask.mock.calls[0][0] as {
      task: {
        name: string;
        httpRequest: {url: string; body: string};
      };
    };
    expect(task.name.endsWith("/hazard-f1-2")).toBe(true);
    expect(task.httpRequest.url).toBe("https://example.com/push/deliver");
    expect(
      JSON.parse(
        Buffer.from(task.httpRequest.body, "base64").toString(),
      ),
    ).toEqual({flagId: "f1"});
  });

  it("treats ALREADY_EXISTS as enqueued", async () => {
    enable();
    createTask.mockRejectedValueOnce({code: 6});
    await expect(
      enqueueHazardPush("f1", "FLOOD", "2"),
    ).resolves.toEqual({enqueued: true});
  });

  it("fails open on other queue errors", async () => {
    enable();
    createTask.mockRejectedValueOnce(new Error("boom"));
    await expect(
      enqueueHazardPush("f1", "FLOOD", "2"),
    ).resolves.toEqual({enqueued: false});
  });
});
