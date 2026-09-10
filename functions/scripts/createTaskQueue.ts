const QUEUE_NAME = "hazard-push";

const main = async (): Promise<void> => {
  const project =
    process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";
  const location = process.env.TASK_QUEUE_LOCATION ?? "asia-southeast1";
  if (project === "") {
    throw new Error("Set GCLOUD_PROJECT before creating the queue");
  }
  const {CloudTasksClient} = await import("@google-cloud/tasks");
  const client = new CloudTasksClient();
  const parent = client.locationPath(project, location);
  const name = client.queuePath(project, location, QUEUE_NAME);
  try {
    await client.createQueue({parent, queue: {name}});
    console.log(`Created queue ${name}`);
  } catch (err) {
    if ((err as {code?: number} | null)?.code === 6) {
      console.log(`Queue ${name} already exists`);
      return;
    }
    throw err;
  }
};

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
