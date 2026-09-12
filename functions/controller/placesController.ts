import {Request, Response} from "express";
import * as placesService from "../service/placesService";
import {sendSuccess, handleServiceError} from "../utils/response";

const searchDirectory = async (req: Request, res: Response) => {
  try {
    const {q, limit} = req.body;
    const result = await placesService.searchDirectory({q, limit});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {searchDirectory};
