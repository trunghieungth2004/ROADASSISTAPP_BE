import {Request, Response} from "express";
import * as roleService from "../service/roleService";
import {sendSuccess, handleServiceError} from "../utils/response";

const getRoles = async (_req: Request, res: Response) => {
  try {
    const result = await roleService.getRoles();
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getRoleByUser = async (req: Request, res: Response) => {
  try {
    const {userId} = req.body;
    const result = await roleService.getRoleByUser(userId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {getRoles, getRoleByUser};
