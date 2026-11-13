import {Request, Response} from "express";
import * as adminTicketService from "../service/adminTicketService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const list = async (req: Request, res: Response) => {
  try {
    const {uid: adminUid} = req as AuthedRequest;
    const result = await adminTicketService.listTickets({
      adminUid,
      status: req.body.status,
      limit: req.body.limit,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {list};
