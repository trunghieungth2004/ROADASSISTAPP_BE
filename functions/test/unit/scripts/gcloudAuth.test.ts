import {execFileSync} from "child_process";
import {assertGcloudAuth} from "../../../scripts/gcloudAuth";

jest.mock("child_process", () => ({
  execFileSync: jest.fn(),
}));

const mocked = jest.mocked(execFileSync);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("gcloudAuth.assertGcloudAuth", () => {
  it("throws with the login hint when no usable token exists", () => {
    mocked.mockImplementation(() => {
      throw new Error("ERROR: (gcloud.auth.print-access-token) No credentials");
    });
    expect(() => assertGcloudAuth()).toThrow(
      "gcloud is not authenticated (run: gcloud auth login)",
    );
  });

  it("passes when a token and project are present", () => {
    mocked
      .mockReturnValueOnce("ya29.token")
      .mockReturnValueOnce("roadassistapp-c2e37");
    expect(() => assertGcloudAuth()).not.toThrow();
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("warns instead of throwing when no default project is set", () => {
    mocked
      .mockReturnValueOnce("ya29.token")
      .mockReturnValueOnce("(unset)");
    expect(() => assertGcloudAuth()).not.toThrow();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("no default project"),
    );
  });
});
