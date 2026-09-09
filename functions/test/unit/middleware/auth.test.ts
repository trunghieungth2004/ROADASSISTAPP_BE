import {Request, Response} from "express";
import {requireAuth, requireRole} from "../../../middleware/auth";

const mockRes = () => {
  const res = {} as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("requireAuth", () => {
  it("rejects requests without a bearer token with 401", async () => {
    const res = mockRes();
    const next = jest.fn();
    await requireAuth({headers: {}} as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects malformed authorization headers with 401", async () => {
    const res = mockRes();
    const next = jest.fn();
    await requireAuth(
      {headers: {authorization: "Token abc"}} as Request,
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 404 when the token uid has no user document", async () => {
    const res = mockRes();
    const next = jest.fn();
    await requireAuth(
      {headers: {authorization: "Bearer any-token"}} as Request,
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireRole", () => {
  it("rejects unauthenticated requests with 401", () => {
    const res = mockRes();
    const next = jest.fn();
    requireRole("1")({} as unknown as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects mismatched roles with 403", () => {
    const res = mockRes();
    const next = jest.fn();
    requireRole("1")({userRole: "2"} as unknown as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes matching roles", () => {
    const res = mockRes();
    const next = jest.fn();
    requireRole("1")({userRole: "1"} as unknown as Request, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("supports role arrays", () => {
    const res = mockRes();
    const next = jest.fn();
    requireRole(["1", "2"])({userRole: "2"} as unknown as Request, res, next);
    expect(next).toHaveBeenCalled();
  });
});
