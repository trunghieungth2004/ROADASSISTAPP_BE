import {NextFunction, Request, Response} from "express";
import {auth, db} from "../config/firebase";
import * as userRepository from "../repository/userRepository";
import {SERVICE_ROLE, STATUS_USER} from "../constants/status";
import {ROLE_ADMIN, ROLE_USER} from "../constants/roles";
import * as cacheManager from "../utils/cacheManager";
import {logError, logInfo} from "../utils/logger";

const USER_NS = "user";

interface UserData {
  id: string;
  role: string;
  status?: string;
  trustScore?: number;
  services?: string[];
}

export interface AuthedRequest extends Request {
  uid: string;
  userRole: string;
  userServices: string[];
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

    let userData = await loadUser(uid);
    if (!userData) {
      await userRepository.create(
        uid, {role: ROLE_USER, services: [SERVICE_ROLE.RIDER]});
      userData = {
        id: uid,
        role: ROLE_USER,
        status: STATUS_USER.ACTIVE,
        trustScore: 0,
        services: [SERVICE_ROLE.RIDER],
      };
      cacheManager.set(USER_NS, uid, userData);
      logInfo("auth", "auto-provisioned user", {uid});
    }

    if (userData.status !== STATUS_USER.ACTIVE) {
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
    authed.userServices = Array.isArray(userData.services) ?
      userData.services :
      [];
    next();
  } catch (error) {
    logError("auth", "middleware error", {}, error);
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

export const requireService = (...services: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authed = req as Request & {
      userRole?: string;
      userServices?: string[];
    };
    if (!authed.userRole) {
      res.status(401).json({
        statusCode: 401,
        status: "ERROR",
        message: "Authentication required",
      });
      return;
    }
    if (authed.userRole === ROLE_ADMIN) {
      next();
      return;
    }
    const held = Array.isArray(authed.userServices) ?
      authed.userServices :
      [];
    if (!services.some((service) => held.includes(service))) {
      res.status(403).json({
        statusCode: 403,
        status: "ERROR",
        message: "Service license required",
      });
      return;
    }

    next();
  };
};
