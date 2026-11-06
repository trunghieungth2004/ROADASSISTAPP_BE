import * as billService from "../../../service/billService";
import {generateInvoice} from "../../../service/invoiceService";

jest.mock("../../../service/billService");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");

describe("invoiceService.generateInvoice", () => {
  it("rejects a bill that is not fully paid", async () => {
    jest.mocked(billService.getBill).mockResolvedValue({
      billId: "t1",
      ticketId: "t1",
      status: "UNPAID",
      total: 100000,
      paid: 0,
      due: 100000,
      items: [],
    } as never);
    await expect(generateInvoice({userId: "u1", ticketId: "t1"}))
      .rejects.toMatchObject({statusCode: 400});
  });
});
