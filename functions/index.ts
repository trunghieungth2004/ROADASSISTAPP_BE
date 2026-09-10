import express, {NextFunction, Request, Response} from "express";
import cors from "cors";
import compression from "compression";
import rateLimiter from "express-rate-limit";
import morgan from "morgan";
import * as functions from "firebase-functions";
import {requireAuth, requireRole} from "./middleware/auth";
import {validate} from "./middleware/validate";
import {sanitizeObject} from "./utils/sanitize";
import {handleServiceError} from "./utils/response";
import {schemas} from "./validation/schemas";
import userRoutes from "./routes/userRoutes";
import roleRoutes from "./routes/roleRoutes";
import statusRoutes from "./routes/statusRoutes";
import vehicleProfileRoutes from "./routes/vehicleProfileRoutes";
import alleySegmentRoutes from "./routes/alleySegmentRoutes";
import flagRoutes from "./routes/flagRoutes";
import landmarkRoutes from "./routes/landmarkRoutes";
import routingRoutes from "./routes/routingRoutes";
import shopRoutes from "./routes/shopRoutes";
import diagnosticRoutes from "./routes/diagnosticRoutes";
import dispatchRoutes from "./routes/dispatchRoutes";
import pushRoutes, {mountPushDeliver} from "./routes/pushRoutes";

const app = express();

const routeDeps = {requireAuth, requireRole, validate, schemas};

mountPushDeliver(app, routeDeps);

const limiter = rateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    status: "ERROR",
    message: "Too many requests, please try again later",
  },
});
app.use(limiter);

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
      if (!origin || ALLOWED_ORIGINS.length === 0) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
  }),
);

app.use(express.json({limit: "20mb"}));
app.use(express.urlencoded({extended: true}));
app.use(compression());
app.use(morgan("short"));

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
alleySegmentRoutes(app, routeDeps);
flagRoutes(app, routeDeps);
landmarkRoutes(app, routeDeps);
routingRoutes(app, routeDeps);
shopRoutes(app, routeDeps);
diagnosticRoutes(app, routeDeps);
dispatchRoutes(app, routeDeps);
pushRoutes(app, routeDeps);

app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  handleServiceError(res, err);
});

export const api = functions.https.onRequest(
  {
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 120,
    maxInstances: 20,
  },
  app,
);
