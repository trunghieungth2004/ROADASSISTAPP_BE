import {Request, Response} from "express";
import * as userService from "../service/userService";
import {sendSuccess, handleServiceError} from "../utils/response";

const register = async (req: Request, res: Response) => {
  try {
    const {email, password, displayName} = req.body;
    const result = await userService.register({email, password, displayName});
    sendSuccess(res, result, {
      message: "User registered successfully",
      statusCode: 201,
    });
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getOneUser = async (req: Request, res: Response) => {
  try {
    const {userId} = req.body;
    const result = await userService.getOneUser(userId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getAllUser = async (_req: Request, res: Response) => {
  try {
    const result = await userService.getAllUser();
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateRole = async (req: Request, res: Response) => {
  try {
    const {userId, targetUserId, role} = req.body;
    const result = await userService.updateRole({
      actorId: userId,
      targetUserId,
      role,
    });
    sendSuccess(res, result, {message: "User role updated successfully"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateTrustScore = async (req: Request, res: Response) => {
  try {
    const {targetUserId, trustScore} = req.body;
    const result = await userService.updateTrustScore({
      targetUserId,
      trustScore,
    });
    sendSuccess(res, result, {message: "Trust score updated successfully"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateStatus = async (req: Request, res: Response) => {
  try {
    const {userId, targetUserId, status} = req.body;
    const result = await userService.updateStatus({
      actorId: userId,
      targetUserId,
      status,
    });
    sendSuccess(res, result, {message: "User status updated successfully"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {
  register,
  getOneUser,
  getAllUser,
  updateRole,
  updateTrustScore,
  updateStatus,
};
