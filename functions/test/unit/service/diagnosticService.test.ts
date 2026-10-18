import * as diagnosticRepository from
  "../../../repository/diagnosticRepository";
import {
  createDiagnostic,
  getDiagnostic,
} from "../../../service/diagnosticService";

jest.mock("../../../repository/diagnosticRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("diagnosticService.createDiagnostic", () => {
  it("records the diagnostic", async () => {
    const diagnostic = {id: "d1"};
    jest.mocked(diagnosticRepository.create).mockResolvedValue(
      diagnostic as never,
    );
    await expect(
      createDiagnostic({
        userId: "u1",
        category: "FLAT_TIRE",
        imagePath: "a.jpg",
      }),
    ).resolves.toBe(diagnostic);
    expect(diagnosticRepository.create).toHaveBeenCalledWith({
      userId: "u1",
      category: "FLAT_TIRE",
      imagePath: "diagnostics/u1/a.jpg",
    });
  });
});

describe("diagnosticService.getDiagnostic", () => {
  it("throws 404 for an unknown diagnostic", async () => {
    jest.mocked(diagnosticRepository.findById).mockResolvedValue(null);
    await expect(getDiagnostic("ghost", "u1")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns the diagnostic", async () => {
    const diagnostic = {id: "d1", userId: "u1"};
    jest.mocked(diagnosticRepository.findById).mockResolvedValue(
      diagnostic as never,
    );
    await expect(getDiagnostic("d1", "u1")).resolves.toBe(diagnostic);
  });

  it("rejects access to another user's diagnostic", async () => {
    const diagnostic = {id: "d1", userId: "u2"};
    jest.mocked(diagnosticRepository.findById).mockResolvedValue(
      diagnostic as never,
    );
    await expect(getDiagnostic("d1", "u1")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
