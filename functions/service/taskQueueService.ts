import {BLOCKING_TYPES} from "./closureService";

interface TasksClient {
  queuePath(project: string, location: string, queue: string): string;
  taskPath(
    project: string,
    location: string,
    queue: string,
    taskId: string,
  ): string;
  createTask(request: unknown): Promise<unknown>;
}

const loadClient = async (): Promise<TasksClient> => {
  const {CloudTasksClient} = await import("@google-cloud/tasks");
  return new CloudTasksClient() as unknown as TasksClient;
};

const QUEUE_NAME = "hazard-push";
const ALREADY_EXISTS_CODE = 6;

const tasksEnabled = (): boolean =>
  process.env.CLOUD_TASKS_ENABLED === "true";

const sanitizeTaskId = (raw: string): string =>
  raw.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 400);

const enqueueHazardPush = async (
  flagId: string,
  type: string,
  status: string,
): Promise<{enqueued: boolean}> => {
  if (!tasksEnabled() || !BLOCKING_TYPES.includes(type)) {
    return {enqueued: false};
  }
  const project =
    process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";
  const location = process.env.TASK_QUEUE_LOCATION ?? "asia-southeast1";
  const url = process.env.PUSH_DELIVER_URL ?? "";
  const serviceAccountEmail = process.env.TASK_INVOKER_EMAIL ?? "";
  if (project === "" || url === "" || serviceAccountEmail === "") {
    return {enqueued: false};
  }
  try {
    const client = await loadClient();
    const parent = client.queuePath(project, location, QUEUE_NAME);
    const taskId = sanitizeTaskId(`hazard-${flagId}-${status}`);
    await client.createTask({
      parent,
      task: {
        name: client.taskPath(project, location, QUEUE_NAME, taskId),
        httpRequest: {
          httpMethod: "POST",
          url,
          headers: {"Content-Type": "application/json"},
          body: Buffer.from(JSON.stringify({flagId})).toString("base64"),
          oidcToken: {serviceAccountEmail},
        },
      },
    });
    return {enqueued: true};
  } catch (err) {
    if ((err as {code?: number} | null)?.code === ALREADY_EXISTS_CODE) {
      return {enqueued: true};
    }
    console.error("enqueueHazardPush failed", err);
    return {enqueued: false};
  }
};

export {enqueueHazardPush, tasksEnabled, QUEUE_NAME};
