import {execFileSync} from "child_process";
import {
  ensureQueue,
  locationOf,
  projectOf,
  QUEUE_NAME,
} from "./createTaskQueue";

const FUNCTION_DEFAULT = "api";
const REGION_DEFAULT = "asia-southeast1";
const ENQUEUER_ROLE = "roles/cloudtasks.enqueuer";
const INVOKER_ROLE = "roles/cloudfunctions.invoker";

const functionOf = (): string =>
  process.env.FUNCTION_NAME ?? FUNCTION_DEFAULT;

const regionOf = (): string =>
  process.env.FUNCTION_REGION ?? REGION_DEFAULT;

const gcloud = (args: string[]): string =>
  execFileSync("gcloud", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

interface Binding {
  role?: string;
  members?: string[];
}

const hasBinding = (policyJson: string, role: string, member: string) => {
  const policy = JSON.parse(policyJson) as {bindings?: Binding[]};
  return (policy.bindings ?? []).some(
    (b) => b.role === role && (b.members ?? []).includes(member),
  );
};

const runtimeServiceAccount = (project: string, fn: string): string => {
  const region = regionOf();
  try {
    const email = gcloud([
      "functions",
      "describe",
      fn,
      `--region=${region}`,
      "--format=value(serviceAccountEmail)",
    ]);
    if (email !== "") return email;
  } catch {
    console.log(`Could not describe function ${fn}; using default SA`);
  }
  return `${project}@appspot.gserviceaccount.com`;
};

const queueBindingState = (
  queue: string,
  location: string,
  role: string,
  member: string,
): boolean => {
  try {
    const policy = gcloud([
      "tasks",
      "queues",
      "get-iam-policy",
      queue,
      `--location=${location}`,
    ]);
    return hasBinding(policy, role, member);
  } catch {
    return false;
  }
};

const functionBindingState = (
  fn: string,
  role: string,
  member: string,
): boolean => {
  const policy = gcloud([
    "functions",
    "get-iam-policy",
    fn,
    `--region=${regionOf()}`,
  ]);
  return hasBinding(policy, role, member);
};

const main = async (): Promise<void> => {
  const checkOnly = process.argv.includes("--check");
  const project = projectOf();
  if (project === "") {
    throw new Error("Set GCLOUD_PROJECT before running push setup");
  }
  const location = locationOf();
  const fn = functionOf();
  if (!checkOnly) {
    await ensureQueue(project, location, QUEUE_NAME);
  } else {
    try {
      gcloud([
        "tasks",
        "queues",
        "describe",
        QUEUE_NAME,
        `--location=${location}`,
      ]);
      console.log(`Queue ${QUEUE_NAME} exists`);
    } catch {
      console.log(`Queue ${QUEUE_NAME} is MISSING`);
      process.exitCode = 1;
    }
  }
  const runtimeSa = runtimeServiceAccount(project, fn);
  const invokerSa = process.env.TASK_INVOKER_EMAIL ?? runtimeSa;
  console.log(`Runtime SA: ${runtimeSa}`);
  console.log(`Invoker SA: ${invokerSa}`);
  const runtimeMember = `serviceAccount:${runtimeSa}`;
  const invokerMember = `serviceAccount:${invokerSa}`;
  const enqueueOk = queueBindingState(
    QUEUE_NAME,
    location,
    ENQUEUER_ROLE,
    runtimeMember,
  );
  let invokeOk = false;
  try {
    invokeOk = functionBindingState(fn, INVOKER_ROLE, invokerMember);
  } catch {
    invokeOk = false;
  }
  if (checkOnly) {
    console.log(
      `Enqueue binding (${ENQUEUER_ROLE}): ${enqueueOk ? "OK" : "MISSING"}`,
    );
    console.log(
      `Invoke binding (${INVOKER_ROLE}): ${invokeOk ? "OK" : "MISSING"}`,
    );
    if (!enqueueOk || !invokeOk) process.exitCode = 1;
    return;
  }
  if (enqueueOk) {
    console.log(`Enqueue binding already present for ${runtimeSa}`);
  } else {
    gcloud([
      "tasks",
      "queues",
      "add-iam-policy-binding",
      QUEUE_NAME,
      `--location=${location}`,
      `--member=${runtimeMember}`,
      `--role=${ENQUEUER_ROLE}`,
    ]);
    console.log(`Granted ${ENQUEUER_ROLE} to ${runtimeSa}`);
  }
  if (invokeOk) {
    console.log(`Invoke binding already present for ${invokerSa}`);
  } else {
    gcloud([
      "functions",
      "add-iam-policy-binding",
      fn,
      `--region=${regionOf()}`,
      `--member=${invokerMember}`,
      `--role=${INVOKER_ROLE}`,
    ]);
    console.log(`Granted ${INVOKER_ROLE} to ${invokerSa}`);
  }
};

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
