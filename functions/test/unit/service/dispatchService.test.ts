import * as dispatchRepository from
  "../../../repository/dispatchRepository";
import * as userRepository from "../../../repository/userRepository";
import {
  createDispatch,
  getDispatch,
  updateDispatchStatus,
} from "../../../service/dispatchService";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("dispatchService.createDispatch", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      createDispatch({userId: "ghost", ticketType: "TOW", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("creates the ticket", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const ticket = {id: "t1", status: "1"};
    jest.mocked(dispatchRepository.create).mockResolvedValue(ticket as never);
    await expect(
      createDispatch({userId: "u1", ticketType: "TOW", lat: 1, lng: 2}),
    ).resolves.toBe(ticket);
  });
});

describe("dispatchService.getDispatch", () => {
  it("throws 404 for an unknown ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(null);
    await expect(getDispatch("ghost")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns the ticket", async () => {
    const ticket = {id: "t1"};
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    await expect(getDispatch("t1")).resolves.toBe(ticket);
  });
});

describe("dispatchService.updateDispatchStatus", () => {
  it("rejects illegal statuses with 400", async () => {
    await expect(
      updateDispatchStatus({id: "t1", status: "FLYING"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.findById).not.toHaveBeenCalled();
  });

  it("throws 404 for an unknown ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(null);
    await expect(
      updateDispatchStatus({id: "ghost", status: "2"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("advances the status", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
    } as never);
    jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
    await expect(
      updateDispatchStatus({id: "t1", status: "2"}),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "2",
    );
  });
});
