import {Request, Response} from "express";
import {requireDeliverSecret} from "../../../middleware/deliverAuth";

const mockReq = (secret?: string) =>
  ({
    header: jest.fn().mockReturnValue(secret ?? ""),
  }) as unknown as Request;

const mockRes = () => {
  const res = {} as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("requireDeliverSecret", () => {
  const previous = process.env.PUSH_DELIVER_SECRET;
  afterEach(() => {
    if (previous === undefined) delete process.env.PUSH_DELIVER_SECRET;
    else process.env.PUSH_DELIVER_SECRET = previous;
  });

  it("passes through when no secret is configured", () => {
    delete process.env.PUSH_DELIVER_SECRET;
    const res = mockRes();
    const next = jest.fn();
    requireDeliverSecret(mockReq(), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret with 403", () => {
    process.env.PUSH_DELIVER_SECRET = "s3cret";
    const res = mockRes();
    const next = jest.fn();
    requireDeliverSecret(mockReq("wrong"), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts the configured secret", () => {
    process.env.PUSH_DELIVER_SECRET = "s3cret";
    const res = mockRes();
    const next = jest.fn();
    requireDeliverSecret(mockReq("s3cret"), res, next);
    expect(next).toHaveBeenCalled();
  });
});
