import {NextFunction, Request, Response} from "express";
import {db} from "../config/firebase";
import * as cacheManager from "../utils/cacheManager";

const USER_NS = "user";

interface UserData {
  id: string;
  role: string;
  status?: boolean;
  trustScore?: number;
}

const loadUser = async (userId: string): Promise<UserData | null> => {
  const hit = cacheManager.get(USER_NS, userId) as UserData | undefined;
  if (hit !== undefined) return hit;
  const userDoc = await db.collection("users").doc(userId).get();
  const data = userDoc.exists ?
    ({id: userDoc.id, ...userDoc.data()} as UserData) :
    null;
  if (data) cacheManager.set(USER_NS, userId, data);
  return data;
};

const resolveUserId = (body: unknown): string | undefined => {
  if (!body || typeof body !== "object") return undefined;
  const obj = body as Record<string, unknown>;
  if (obj.userId) return obj.userId as string;
  const searchNested = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).userId
        ) {
          return (item as Record<string, unknown>).userId as string;
        }
      }
    } else if (value && typeof value === "object") {
      for (const [key, val] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (key === "userId" && val) return val as string;
        const found = searchNested(val);
        if (found) return found;
      }
    }
    return undefined;
  };
  return searchNested(body);
};

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = resolveUserId(req.body);
    if (!userId) {
      res.status(400).json({
        statusCode: 400,
        status: "ERROR",
        message: "userId is required",
      });
      return;
    }

    const userData = await loadUser(userId);
    if (!userData) {
      res.status(404).json({
        statusCode: 404,
        status: "ERROR",
        message: "User with the provided ID does not exist",
      });
      return;
    }

    if (userData.status !== true) {
      res.status(403).json({
        statusCode: 403,
        status: "ERROR",
        message: "User with the provided ID is inactive",
      });
      return;
    }

    (req as Request & { userRole: string; userId: string }).userRole =
      userData.role;
    (req as Request & { userRole: string; userId: string }).userId = userId;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({
      statusCode: 500,
      status: "ERROR",
      message: "Internal server error during authentication",
    });
  }
};

export const requireRole = (role: string | string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authed = req as Request & { userRole?: string };
    if (!authed.userRole) {
      res.status(401).json({
        statusCode: 401,
        status: "ERROR",
        message: "Authentication required",
      });
      return;
    }

    if (Array.isArray(role)) {
      if (!role.includes(authed.userRole)) {
        res.status(403).json({
          statusCode: 403,
          status: "ERROR",
          message: "Insufficient permissions",
        });
        return;
      }
    } else if (authed.userRole !== role) {
      res.status(403).json({
        statusCode: 403,
        status: "ERROR",
        message: "Insufficient permissions",
      });
      return;
    }

    next();
  };
};
