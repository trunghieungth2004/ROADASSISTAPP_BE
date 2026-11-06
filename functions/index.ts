import express, {NextFunction, Request, Response} from "express";
import cors from "cors";
import compression from "compression";
import rateLimiter from "express-rate-limit";
import {clientIpKey} from "./middleware/rateLimit";
import morgan from "morgan";
import * as functions from "firebase-functions";
import {requireAuth, requireRole, requireService} from "./middleware/auth";
import {validate} from "./middleware/validate";
import {requestIdMiddleware, logError} from "./utils/logger";
import {sanitizeObject} from "./utils/sanitize";
import {handleServiceError} from "./utils/response";
import {schemas} from "./validation/schemas";
import userRoutes from "./routes/userRoutes";
import roleRoutes from "./routes/roleRoutes";
import statusRoutes from "./routes/statusRoutes";
import vehicleProfileRoutes from "./routes/vehicleProfileRoutes";
import flagRoutes from "./routes/flagRoutes";
import landmarkRoutes from "./routes/landmarkRoutes";
import placesRoutes from "./routes/placesRoutes";
import savedPlaceRoutes from "./routes/savedPlaceRoutes";
import routingRoutes from "./routes/routingRoutes";
import providerRoutes from "./routes/providerRoutes";
import dispatchRoutes, {mountDispatchDeliver} from "./routes/dispatchRoutes";
import ratingRoutes from "./routes/ratingRoutes";
import pushRoutes, {mountPushDeliver} from "./routes/pushRoutes";
import paymentRoutes, {mountPaymentIpn} from "./routes/paymentRoutes";
import billRoutes from "./routes/billRoutes";
import payoutRoutes from "./routes/payoutRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import chatRoutes from "./routes/chatRoutes";
import adminRoutes from "./routes/adminRoutes";
import refundRoutes from "./routes/refundRoutes";
import warrantyRoutes from "./routes/warrantyRoutes";
import disputeRoutes from "./routes/disputeRoutes";
import bookingRoutes from "./routes/bookingRoutes";
import supportRoutes from "./routes/supportRoutes";
import * as flagService from "./service/flagService";
import {chatService} from "./service/chatService";
import * as userService from "./service/userService";
import * as routingService from "./service/routingService";
import * as routingCacheRepository from "./repository/routingCacheRepository";
import * as dispatchService from "./service/dispatchService";
import * as bookingService from "./service/bookingService";
import * as paymentReminderService from "./service/paymentReminderService";
import * as warrantyService from "./service/warrantyService";

export {clientIpKey};

const app = express();

app.set("trust proxy", 1);

const routeDeps = {
  requireAuth,
  requireRole,
  requireService,
  validate,
  schemas,
};

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      return callback(null, ALLOWED_ORIGINS.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Request-Id",
    ],
    credentials: true,
    preflightContinue: true,
  }),
);
app.options("*", (_req: Request, res: Response) => {
  res.status(204).end();
});

mountPushDeliver(app, routeDeps);
mountDispatchDeliver(app, routeDeps);
mountPaymentIpn(app);

const skipPreflight = (req: Request): boolean => req.method === "OPTIONS";

const limiter = rateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  skip: skipPreflight,
  validate: {forwardedHeader: false},
  message: {
    statusCode: 429,
    status: "ERROR",
    message: "Too many requests, please try again later",
  },
});
app.use(limiter);

app.use(express.json({limit: "20mb"}));
app.use(express.urlencoded({extended: true}));
app.use(compression());
app.use(morgan("short"));
app.use(requestIdMiddleware);

app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeObject(req.body) as Record<string, unknown>;
  }
  next();
});

app.get("/", (_req: Request, res: Response) => {
  res.send("RoadAssist backend is running");
});

userRoutes(app, routeDeps);
roleRoutes(app, routeDeps);
statusRoutes(app, routeDeps);
vehicleProfileRoutes(app, routeDeps);
flagRoutes(app, routeDeps);
landmarkRoutes(app, routeDeps);
placesRoutes(app, routeDeps);
savedPlaceRoutes(app, routeDeps);
routingRoutes(app, routeDeps);
providerRoutes(app, routeDeps);
dispatchRoutes(app, routeDeps);
ratingRoutes(app, routeDeps);
pushRoutes(app, routeDeps);
paymentRoutes(app, routeDeps);
billRoutes(app, routeDeps);
payoutRoutes(app, routeDeps);
notificationRoutes(app, routeDeps);
chatRoutes(app, routeDeps);
adminRoutes(app, routeDeps);
refundRoutes(app, routeDeps);
warrantyRoutes(app, routeDeps);
disputeRoutes(app, routeDeps);
bookingRoutes(app, routeDeps);
supportRoutes(app, routeDeps);

app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  handleServiceError(res, err);
});

export {app};

export const api = functions.https.onRequest(
  {
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 120,
    maxInstances: 20,
  },
  app,
);

const runSweep = async (
  name: string,
  sweep: () => Promise<unknown>,
): Promise<void> => {
  try {
    await sweep();
  } catch (err) {
    logError("scheduler", "sweep-failed", {name}, err);
  }
};

export const sweepDispatch = functions.scheduler.onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "Asia/Ho_Chi_Minh",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async () => {
    await runSweep(
      "sweepDispatchSla",
      () => dispatchService.sweepDispatchSla(),
    );
    await runSweep(
      "sweepUnfixGrace",
      () => dispatchService.sweepUnfixGrace(),
    );
    await runSweep(
      "sweepStaleWalkIns",
      () => dispatchService.sweepStaleWalkIns(),
    );
    await runSweep(
      "sweepLateTows",
      () => dispatchService.sweepLateTows(),
    );
    await runSweep(
      "sweepMobileTowOffers",
      () => dispatchService.sweepMobileTowOffers(),
    );
    await runSweep(
      "sweepExpiredQuotes",
      () => dispatchService.sweepExpiredQuotes(),
    );
    await runSweep(
      "sweepExpiredHolds",
      () => dispatchService.sweepExpiredHolds(),
    );
    await runSweep(
      "sweepPaymentReminders",
      () => paymentReminderService.sweepPaymentReminders(),
    );
    await runSweep(
      "sweepBookings",
      () => bookingService.sweepBookings(),
    );
  },
);

export const sweepMaintenance = functions.scheduler.onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Ho_Chi_Minh",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async () => {
    await runSweep(
      "sweepWarrantyRebooks",
      () => warrantyService.sweepWarrantyRebooks(),
    );
    await runSweep(
      "expireChats",
      () => chatService.expireChats(),
    );
    await runSweep(
      "sweepStalePresence",
      () => userService.sweepStalePresence(),
    );
  },
);

export const sweepData = functions.scheduler.onSchedule(
  {
    schedule: "every 30 minutes",
    timeZone: "Asia/Ho_Chi_Minh",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async () => {
    await runSweep(
      "expireFlags",
      () => flagService.expireFlags(),
    );
    await runSweep(
      "sweepActiveRoutes",
      () => routingService.sweepActiveRoutes(),
    );
    await runSweep(
      "deleteExpiredRoutes",
      () => routingCacheRepository.deleteExpired(),
    );
  },
);
