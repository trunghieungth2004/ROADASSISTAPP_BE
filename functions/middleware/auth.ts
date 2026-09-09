import {NextFunction, Request, Response} from "express";
import {auth, db} from "../config/firebase";
import * as cacheManager from "../utils/cacheManager";

const USER_NS = "user";

interface UserData {
  id: string;
  role: string;
  status?: boolean;
  trustScore?: number;
}

export interface AuthedRequest extends Request {
  uid: string;
  userRole: string;
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

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      res.status(401).json({
        statusCode: 401,
        status: "ERROR",
        message: "Authentication required",
      });
      return;
    }

    let uid: string;
    try {
      const decoded = await auth.verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      res.status(401).json({
        statusCode: 401,
        status: "ERROR",
        message: "Invalid or expired token",
      });
      return;
    }

    const userData = await loadUser(uid);
    if (!userData) {
      res.status(404).json({
        statusCode: 404,
        status: "ERROR",
        message: "User not found",
      });
      return;
    }

    if (userData.status !== true) {
      res.status(403).json({
        statusCode: 403,
        status: "ERROR",
        message: "User is inactive",
      });
      return;
    }

    const authed = req as AuthedRequest;
    authed.uid = uid;
    authed.userRole = userData.role;
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
