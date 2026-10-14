import {Request, Response} from "express";
import {
  __resetOidcClientForTests,
  requireDeliverIdentity,
} from "../../../middleware/deliverAuth";

jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn(),
}));

const mockAuthReq = (headers: Record<string, string>) =>
  ({
    header: jest.fn((name: string) => headers[name] ?? ""),
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

describe("requireDeliverIdentity", () => {
  const OLD_ENV = process.env;
  let OAuth2ClientMock: jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {...OLD_ENV};
    delete process.env.PUSH_DELIVER_SECRET;
    process.env.TASK_INVOKER_EMAIL = "tasks@example.iam.gserviceaccount.com";
    process.env.PUSH_DELIVER_URL = "https://api.example.com/push/deliver";
    process.env.DISPATCH_DELIVER_URL =
      "https://api.example.com/dispatch/deliver";
    OAuth2ClientMock = (
      jest.requireMock("google-auth-library") as {
        OAuth2Client: jest.Mock;
      }
    ).OAuth2Client;
    __resetOidcClientForTests();
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  const verifiedAs = (email: string) => {
    OAuth2ClientMock.mockImplementation(() => ({
      verifyIdToken: jest.fn(async () => ({
        getPayload: () => ({email}),
      })),
    }));
  };

  it("accepts a Google-signed token for the invoker", async () => {
    verifiedAs("tasks@example.iam.gserviceaccount.com");
    const res = mockRes();
    const next = jest.fn();
    await requireDeliverIdentity(
      mockAuthReq({Authorization: "Bearer good-token"}),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(OAuth2ClientMock).toHaveBeenCalled();
  });

  it("rejects a valid token for the wrong identity", async () => {
    verifiedAs("stranger@example.iam.gserviceaccount.com");
    const res = mockRes();
    const next = jest.fn();
    await requireDeliverIdentity(
      mockAuthReq({Authorization: "Bearer good-token"}),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an unverifiable token", async () => {
    OAuth2ClientMock.mockImplementation(() => ({
      verifyIdToken: jest.fn(async () => {
        throw new Error("bad signature");
      }),
    }));
    const res = mockRes();
    const next = jest.fn();
    await requireDeliverIdentity(
      mockAuthReq({Authorization: "Bearer bad-token"}),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when nothing is presented", async () => {
    const res = mockRes();
    const next = jest.fn();
    await requireDeliverIdentity(mockAuthReq({}), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("fails closed when the invoker email is unset", async () => {
    verifiedAs("tasks@example.iam.gserviceaccount.com");
    delete process.env.TASK_INVOKER_EMAIL;
    const res = mockRes();
    const next = jest.fn();
    await requireDeliverIdentity(
      mockAuthReq({Authorization: "Bearer good-token"}),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
