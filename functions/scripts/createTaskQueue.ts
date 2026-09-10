const QUEUE_NAME = "hazard-push";
const ALREADY_EXISTS_CODE = 6;

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
    await client.createQueue({parent, queue: {name}});
    console.log(`Created queue ${name}`);
  } catch (err) {
    if ((err as {code?: number} | null)?.code === ALREADY_EXISTS_CODE) {
      console.log(`Queue ${name} already exists`);
      return name;
    }
    throw err;
  }
  return name;
};

const main = async (): Promise<void> => {
  await ensureQueue();
};

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export {ensureQueue, queueNameOf, projectOf, locationOf, QUEUE_NAME};
