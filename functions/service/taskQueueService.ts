import {BLOCKING_TYPES} from "./closureService";
import {logError} from "../utils/logger";

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
const DISPATCH_QUEUE_NAME = "dispatch-push";
const ALREADY_EXISTS_CODE = 6;

const tasksEnabled = (): boolean =>
  process.env.CLOUD_TASKS_ENABLED === "true";

const deliverSecret = (): string => process.env.PUSH_DELIVER_SECRET ?? "";

const deliverHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = deliverSecret();
  if (secret !== "") headers["X-Push-Secret"] = secret;
  return headers;
};

const sanitizeTaskId = (raw: string): string =>
  raw.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 400);

const enqueueHazardPush = async (
  flagId: string,
  type: string,
  status: string,
  extra?: {
    type?: string;
    lat?: number;
    lng?: number;
    radiusMeters?: number;
    removed?: boolean;
  },
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
          headers: deliverHeaders(),
          body: Buffer.from(
            JSON.stringify({flagId, ...extra}),
          ).toString("base64"),
          oidcToken: {serviceAccountEmail},
        },
      },
    });
    return {enqueued: true};
  } catch (err) {
    if ((err as {code?: number} | null)?.code === ALREADY_EXISTS_CODE) {
      return {enqueued: true};
    }
    logError("tasks", "enqueueHazardPush failed", {}, err);
    return {enqueued: false};
  }
};

const enqueueDispatchPush = async (
  ticketId: string,
  taskSuffix = "",
  extra: Record<string, string> = {},
): Promise<{enqueued: boolean}> => {
  if (!tasksEnabled()) return {enqueued: false};
  const project =
    process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";
  const location = process.env.TASK_QUEUE_LOCATION ?? "asia-southeast1";
  const url =
    process.env.DISPATCH_DELIVER_URL ??
    process.env.PUSH_DELIVER_URL ??
    "";
  const serviceAccountEmail = process.env.TASK_INVOKER_EMAIL ?? "";
  if (project === "" || url === "" || serviceAccountEmail === "") {
    return {enqueued: false};
  }
  try {
    const client = await loadClient();
    const parent = client.queuePath(
      project,
      location,
      DISPATCH_QUEUE_NAME,
    );
    const taskId = sanitizeTaskId(`dispatch-${ticketId}${taskSuffix}`);
    await client.createTask({
      parent,
      task: {
        name: client.taskPath(
          project,
          location,
          DISPATCH_QUEUE_NAME,
          taskId,
        ),
        httpRequest: {
          httpMethod: "POST",
          url,
          headers: deliverHeaders(),
          body: Buffer.from(
            JSON.stringify({ticketId, ...extra}),
          ).toString("base64"),
          oidcToken: {serviceAccountEmail},
        },
      },
    });
    return {enqueued: true};
  } catch (err) {
    if ((err as {code?: number} | null)?.code === ALREADY_EXISTS_CODE) {
      return {enqueued: true};
    }
    logError("tasks", "enqueueDispatchPush failed", {}, err);
    return {enqueued: false};
  }
};

export {enqueueHazardPush, enqueueDispatchPush, tasksEnabled,
  QUEUE_NAME, DISPATCH_QUEUE_NAME};
