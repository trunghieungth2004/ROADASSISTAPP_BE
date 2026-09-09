import {NextFunction, Request, Response} from "express";
import {db} from "../../config/firebase";
import {STATUS_USER} from "../../constants/status";

interface AuthedRequest extends Request {
  uid?: string;
  userId?: string;
  userRole?: string;
}

const stubRequireAuth = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authed = req as AuthedRequest;
  authed.uid = "test-user";
  authed.userId = "test-user";
  authed.userRole = "1";
  next();
};

const stubRequireRole =
  () => (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };

const integrationRequireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
      res.status(401).json({
        statusCode: 401,
        status: "ERROR",
        message: "Authentication required",
      });
      return;
    }
    const doc = await db.collection("users").doc(token).get();
    if (!doc.exists) {
      res.status(404).json({
        statusCode: 404,
        status: "ERROR",
        message: "User not found",
      });
      return;
    }
    const data = doc.data() as {role?: string; status?: string};
    if (data.status !== STATUS_USER.ACTIVE) {
      res.status(403).json({
        statusCode: 403,
        status: "ERROR",
        message: "User is inactive",
      });
      return;
    }
    const authed = req as AuthedRequest;
    authed.uid = token;
    authed.userId = token;
    authed.userRole = data.role;
    next();
  } catch (err) {
    next(err);
  }
};

const integrationRequireRole =
  (role: string | string[]) =>
    (req: Request, res: Response, next: NextFunction): void => {
      const userRole = (req as AuthedRequest).userRole;
      if (!userRole) {
        res.status(401).json({
          statusCode: 401,
          status: "ERROR",
          message: "Authentication required",
        });
        return;
      }
      const allowed = Array.isArray(role) ?
        role.includes(userRole) :
        userRole === role;
      if (!allowed) {
        res.status(403).json({
          statusCode: 403,
          status: "ERROR",
          message: "Insufficient permissions",
        });
        return;
      }
      next();
    };

export {
  stubRequireAuth,
  stubRequireRole,
  integrationRequireAuth,
  integrationRequireRole,
};
