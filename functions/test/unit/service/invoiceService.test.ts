import * as billService from "../../../service/billService";
import {generateInvoice, rowsFor} from "../../../service/invoiceService";

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

describe("invoiceService.rowsFor", () => {
  it("renders each invoice item once", () => {
    const rows = rowsFor({
      kind: "REPAIR",
      amount: 300,
      services: [{name: "Service", qty: 1, unitPrice: 100, amount: 100}],
      extras: [{name: "Part", qty: 2, unitPrice: 100, amount: 200}],
      items: [
        {name: "Service", qty: 1, unitPrice: 100, amount: 100},
        {name: "Part", qty: 2, unitPrice: 100, amount: 200},
      ],
    } as never);
    expect(rows).toEqual([
      {label: "Service", qty: 1, unit: 100, amount: 100},
      {label: "Part", qty: 2, unit: 100, amount: 200},
    ]);
  });

  it("keeps notes on invoice items", () => {
    const rows = rowsFor({
      kind: "REPAIR",
      amount: 100,
      items: [{name: "Part", qty: 1, unitPrice: 100, amount: 100, note: "OEM"}],
    } as never);
    expect(rows).toEqual([
      {label: "Part (OEM)", qty: 1, unit: 100, amount: 100},
    ]);
  });

  it("falls back to service and extra groups without items", () => {
    const rows = rowsFor({
      kind: "REPAIR",
      amount: 300,
      services: [{name: "Service", qty: 1, unitPrice: 100, amount: 100}],
      extras: [{name: "Part", qty: 2, unitPrice: 100, amount: 200}],
    } as never);
    expect(rows).toEqual([
      {label: "Service", qty: 1, unit: 100, amount: 100},
      {label: "Part", qty: 2, unit: 100, amount: 200},
    ]);
  });

  it("renders a tow fallback when no line items exist", () => {
    const rows = rowsFor({
      kind: "TOW_FARE",
      amount: 500,
      items: [],
      services: [],
      extras: [],
    } as never);
    expect(rows).toEqual([
      {label: "Tow fare", qty: 1, unit: 500, amount: 500},
    ]);
  });
});
