import {Request, Response} from "express";
import * as adminSearchService from "../service/adminSearchService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const search = async (req: Request, res: Response) => {
  try {
    const {uid: adminUid} = req as AuthedRequest;
    const result = await adminSearchService.search({
      adminUid,
      query: req.body.query,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {search};
