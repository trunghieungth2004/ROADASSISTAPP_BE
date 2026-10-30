process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "localhost:9099";
process.env.STORAGE_EMULATOR_HOST ??= "http://localhost:9199";
process.env.GCLOUD_PROJECT = "test-project";
process.env.TASK_INVOKER_EMAIL = "tasks@test-project.iam.gserviceaccount.com";
process.env.PUSH_DELIVER_URL = "https://test.example.com/push/deliver";
process.env.DISPATCH_DELIVER_URL =
  "https://test.example.com/dispatch/deliver";
process.env.WRITE_LIMIT_DISABLED = "true";
process.env.ALLOWED_ORIGINS = "https://roadassistapp-c2e37.web.app";
process.env.VALHALLA_URL = "http://localhost:8002";
process.env.CACHE_ENABLED = "false";
