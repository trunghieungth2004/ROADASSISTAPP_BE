const QUEUE_NAME = "hazard-push";
const DISPATCH_QUEUE_NAME = "dispatch-push";
const ALREADY_EXISTS_CODE = 6;

const RETRY_CONFIG = {
  maxAttempts: 5,
  minBackoff: {seconds: 10},
  maxBackoff: {seconds: 600},
  maxDoublings: 3,
};

const projectOf = (): string =>
  process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";

const locationOf = (): string =>
  process.env.TASK_QUEUE_LOCATION ?? "asia-southeast1";

const queueNameOf = (
  project: string,
  location: string,
  queue = QUEUE_NAME,
): string =>
  `projects/${project}/locations/${location}/queues/${queue}`;

const retryMatches = (retry: unknown): boolean => {
  if (retry === null || typeof retry !== "object") return false;
  const current = retry as {
    maxAttempts?: unknown;
    minBackoff?: {seconds?: unknown};
    maxBackoff?: {seconds?: unknown};
    maxDoublings?: unknown;
  };
  return (
    current.maxAttempts === RETRY_CONFIG.maxAttempts &&
    String(current.minBackoff?.seconds ?? "") === "10" &&
    String(current.maxBackoff?.seconds ?? "") === "600" &&
    current.maxDoublings === RETRY_CONFIG.maxDoublings
  );
};

const ensureRetryPolicy = async (
  client: Pick<
    import("@google-cloud/tasks", {with: {"resolution-mode": "import"}})
      .CloudTasksClient,
    "getQueue" | "updateQueue"
  >,
  name: string,
): Promise<void> => {
  const [current] = (await client.getQueue({name})) as unknown as Array<{
    retryConfig?: unknown;
  }>;
  if (retryMatches(current?.retryConfig)) {
    console.log(`Queue ${name} retry policy already current`);
    return;
  }
  await client.updateQueue({
    queue: {name, retryConfig: RETRY_CONFIG},
    updateMask: {paths: ["retry_config"]},
  });
  console.log(`Queue ${name} retry policy updated`);
};

const ensureQueue = async (
  project = projectOf(),
  location = locationOf(),
  queue = QUEUE_NAME,
): Promise<string> => {
  if (project === "") {
    throw new Error("Set GCLOUD_PROJECT before creating the queue");
  }
  const {CloudTasksClient} = await import("@google-cloud/tasks");
  const client = new CloudTasksClient();
  const parent = client.locationPath(project, location);
  const name = queueNameOf(project, location, queue);
  try {
    await client.createQueue({
      parent,
      queue: {name, retryConfig: RETRY_CONFIG},
    });
    console.log(`Created queue ${name}`);
  } catch (err) {
    if ((err as {code?: number} | null)?.code === ALREADY_EXISTS_CODE) {
      console.log(`Queue ${name} already exists`);
      await ensureRetryPolicy(client, name);
      return name;
    }
    throw err;
  }
  return name;
};

const main = async (): Promise<void> => {
  await ensureQueue();
  await ensureQueue(
    projectOf(),
    locationOf(),
    DISPATCH_QUEUE_NAME,
  );
};

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export {ensureQueue, queueNameOf, projectOf, locationOf, QUEUE_NAME,
  DISPATCH_QUEUE_NAME, RETRY_CONFIG};
