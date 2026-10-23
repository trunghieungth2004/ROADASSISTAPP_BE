import {Request, Response} from "express";
import * as adminService from "../service/adminService";
import * as payoutService from "../service/payoutService";
import * as paymentService from "../service/paymentService";
import * as platformConfigService from "../service/platformConfigService";
import * as reportService from "../service/reportService";
import {REPORT_CSV_MIME, REPORT_FORMAT} from "../constants/reports";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const getConfig = async (_req: Request, res: Response) => {
  try {
    const result = await platformConfigService.getConfig();
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateConfig = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const result = await platformConfigService.updateConfig(
      (req.body ?? {}) as Record<string, unknown>,
      uid,
    );
    sendSuccess(res, result, {message: "Platform config updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const payout = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {paymentId} = req.body;
    const result = await adminService.payout({paymentId, adminUid: uid});
    sendSuccess(res, result, {message: "Payout recorded"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const pendingPayouts = async (req: Request, res: Response) => {
  try {
    const {payeeId, limit} = req.body ?? {};
    const result = await payoutService.pendingSettlements({payeeId, limit});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const settlePayoutBatch = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {payeeId, paymentIds, payoutRef, note} = req.body;
    const result = await payoutService.settleBatch({
      adminUid: uid,
      payeeId,
      paymentIds,
      payoutRef,
      note,
    });
    sendSuccess(res, result, {message: "Payout batch settled"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const listPayoutBatches = async (req: Request, res: Response) => {
  try {
    const {payeeId, limit} = req.body ?? {};
    const result = await payoutService.listBatches({payeeId, limit});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const auditPayments = async (req: Request, res: Response) => {
  try {
    const {limit} = req.body ?? {};
    const result = await paymentService.auditLedger({limit});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const revenueReport = async (req: Request, res: Response) => {
  try {
    const {from, to, format} = req.body ?? {};
    const report = await reportService.revenueReport({from, to});
    if (format === REPORT_FORMAT.CSV) {
      res.setHeader("Content-Type", REPORT_CSV_MIME);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="revenue-${report.from.slice(0, 10)}-` +
        `${report.to.slice(0, 10)}.csv"`,
      );
      res.send(reportService.revenueCsv(report));
      return;
    }
    sendSuccess(res, report);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const payeeReport = async (req: Request, res: Response) => {
  try {
    const {from, to, format} = req.body ?? {};
    const report = await reportService.payeesReport({from, to});
    if (format === REPORT_FORMAT.CSV) {
      res.setHeader("Content-Type", REPORT_CSV_MIME);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="payees-${report.from.slice(0, 10)}-` +
        `${report.to.slice(0, 10)}.csv"`,
      );
      res.send(reportService.payeesCsv(report));
      return;
    }
    sendSuccess(res, report);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {
  getConfig,
  updateConfig,
  payout,
  pendingPayouts,
  settlePayoutBatch,
  listPayoutBatches,
  auditPayments,
  revenueReport,
  payeeReport,
};
