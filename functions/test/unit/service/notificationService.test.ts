import * as userRepository from "../../../repository/userRepository";
import {
  getPrefs,
  prefsFor,
  updatePrefs,
} from "../../../service/notificationService";
import {NotFoundError} from "../../../utils/errors";

jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.resetAllMocks();
});

describe("notification preferences", () => {
  it("defaults missing preferences to enabled", () => {
    expect(prefsFor(undefined)).toEqual({
      paymentUpdates: true,
      payoutUpdates: true,
    });
    expect(prefsFor({paymentUpdates: false})).toEqual({
      paymentUpdates: false,
      payoutUpdates: true,
    });
    expect(prefsFor({paymentUpdates: "no", payoutUpdates: null})).toEqual({
      paymentUpdates: true,
      payoutUpdates: true,
    });
  });

  it("reads the stored preferences", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
      notificationPrefs: {paymentUpdates: false, payoutUpdates: true},
    });
    await expect(getPrefs("u1")).resolves.toEqual({
      paymentUpdates: false,
      payoutUpdates: true,
    });
  });

  it("merges updates without resetting the other toggle", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
      notificationPrefs: {paymentUpdates: true, payoutUpdates: false},
    });
    const next = await updatePrefs({userId: "u1", paymentUpdates: false});
    expect(next).toEqual({paymentUpdates: false, payoutUpdates: false});
    expect(userRepository.updateNotificationPrefs).toHaveBeenCalledWith(
      "u1",
      {paymentUpdates: false, payoutUpdates: false},
    );
  });

  it("rejects unknown users", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(getPrefs("missing")).rejects.toThrow(NotFoundError);
  });
});
