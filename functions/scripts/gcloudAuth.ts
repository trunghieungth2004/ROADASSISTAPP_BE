import {execFileSync} from "child_process";

const assertGcloudAuth = (): void => {
  try {
    execFileSync("gcloud", ["auth", "print-access-token"], {
      stdio: "ignore",
    });
  } catch {
    throw new Error("gcloud is not authenticated (run: gcloud auth login)");
  }
  try {
    const project = execFileSync(
      "gcloud",
      ["config", "get-value", "project"],
      {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]},
    ).trim();
    if (!project || project === "(unset)") {
      console.log(
        "gcloud has no default project set; " +
        "continuing with explicit --project flags",
      );
    }
  } catch {
    console.log(
      "Could not read gcloud default project; " +
      "continuing with explicit --project flags",
    );
  }
};

export {assertGcloudAuth};
