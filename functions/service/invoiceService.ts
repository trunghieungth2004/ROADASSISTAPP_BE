import {readFileSync} from "fs";
import {join} from "path";
import {randomBytes} from "crypto";
import fontkit from "@pdf-lib/fontkit";
import {PDFDocument, rgb, type PDFFont} from "pdf-lib";
import {db, storage} from "../config/firebase";
import * as billService from "./billService";
import * as providerRepository from "../repository/providerRepository";
import {NotFoundError, ValidationError} from "../utils/errors";
import {PAYMENT_CURRENCY} from "../constants/payments";

const INVOICE_COLLECTION = "invoices";
const COUNTER_COLLECTION = "invoice_counters";
const INVOICE_LAYOUT_VERSION = 2;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const GUTTER = 20;
const COLUMN_WIDTH = (CONTENT_WIDTH - GUTTER) / 2;
const RIGHT_COLUMN_X = MARGIN + COLUMN_WIDTH + GUTTER;
const DESC_WIDTH = 330;
const QTY_RIGHT = 408;
const UNIT_RIGHT = 478;
const AMOUNT_RIGHT = PAGE_WIDTH - MARGIN;

const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.45, 0.5);
const BRAND = rgb(0.01, 0.52, 0.78);
const LINE = rgb(0.88, 0.9, 0.92);
const BAND = rgb(0.96, 0.97, 0.98);
const PAID = rgb(0.06, 0.6, 0.36);
const WHITE = rgb(1, 1, 1);

type Bill = Awaited<ReturnType<typeof billService.getBill>>;
type BillItem = Bill["items"][number];

type Row = {label: string; qty: number; unit: number; amount: number};

const fontBytes = (): {regular: Buffer; bold: Buffer} => {
  const root = process.cwd();
  const regular = readFileSync(join(root, "assets", "NotoSans-Regular.ttf"));
  const bold = readFileSync(join(root, "assets", "NotoSans-Bold.ttf"));
  return {regular, bold};
};

const money = (value: number): string =>
  `${value.toLocaleString("vi-VN")} ${PAYMENT_CURRENCY}`;

const dateLabel = (value: string | null | undefined): string => {
  if (typeof value !== "string" || value === "") return "";
  const at = Date.parse(value);
  if (Number.isNaN(at)) return "";
  return new Date(at).toLocaleDateString("vi-VN");
};

const methodLabel = (method: string): string => {
  if (method === "CASH") return "Cash";
  if (method === "SEPAY") return "Bank transfer";
  return method;
};

const wrap = (
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current === "" ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current !== "") lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines.length > 0 ? lines : [""];
};

const clipText = (
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string => {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let text = value;
  while (text.length > 0 &&
    font.widthOfTextAtSize(`${text}...`, size) > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text}...`;
};

const rowsFor = (item: BillItem): Row[] => {
  const source: Array<{
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
    note?: string;
  }> = Array.isArray(item.items) && item.items.length > 0 ?
    item.items :
    [...(item.services ?? []), ...(item.extras ?? [])];
  const rows = source.map((row) => ({
    label: `${row.name}${typeof row.note === "string" && row.note !== "" ?
      ` (${row.note})` : ""}`,
    qty: row.qty,
    unit: row.unitPrice,
    amount: row.amount,
  }));
  if (rows.length > 0) return rows;
  return [{
    label: item.kind === "TOW_FARE" ? "Tow fare" : "Repair service",
    qty: 1,
    unit: item.amount,
    amount: item.amount,
  }];
};


const serviceLabelFor = (item: BillItem | undefined): string => {
  if (item?.serviceType === "TOW") return "Tow";
  if (item?.serviceType === "SOS") return "SOS";
  return "Repair";
};

const vehicleLabelFor = (item: BillItem | undefined): string => {
  const parts = [item?.vehicleLabel, item?.vehiclePlate]
    .filter((value): value is string =>
      typeof value === "string" && value !== "");
  return parts.length > 0 ? parts.join(" · ") : "-";
};

const paymentLabelFor = (item: BillItem | undefined): string => {
  return item?.payment ? methodLabel(item.payment.method) : "-";
};

const metaRowsFor = (
  bill: Bill,
  item: BillItem | undefined,
): Array<[string, string]> => [
  ["TICKET", bill.ticketId],
  ["SERVICE", serviceLabelFor(item)],
  ["VEHICLE", vehicleLabelFor(item)],
  ["PAYMENT", paymentLabelFor(item)],
];

const providerNameFor = (
  party: BillItem["provider"],
  provider: Record<string, unknown> | null,
): string => {
  if (party?.name !== undefined && party.name !== "") return party.name;
  if (typeof provider?.name === "string" && provider.name !== "") {
    return provider.name;
  }
  return "RoadAssist provider";
};

const providerAddressFor = (
  party: BillItem["provider"],
  provider: Record<string, unknown> | null,
): string => {
  if (typeof party?.label === "string") return party.label;
  return typeof provider?.label === "string" ? provider.label : "";
};

const taxCodeFor = (provider: Record<string, unknown> | null): string => {
  return typeof provider?.taxCode === "string" ? provider.taxCode : "";
};

const totalsFor = (
  bill: Bill,
  item: BillItem | undefined,
): Array<[string, number, boolean]> => {
  const deposit = item?.deposit?.amount ?? 0;
  const rows: Array<[string, number, boolean]> = [["Total", bill.total, true]];
  if (deposit > 0) rows.push(["Deposit credit", -deposit, false]);
  rows.push(["Paid", bill.paid, false]);
  return rows;
};

const paymentLineFor = (item: BillItem | undefined): string => {
  const payment = item?.payment;
  if (!payment) return "";
  return [
    methodLabel(payment.method),
    dateLabel(payment.confirmedAt ?? payment.createdAt),
  ].filter((part) => part !== "").join(" - ");
};

const nextNumber = async (
  providerId: string,
  year: number,
): Promise<number> => {
  const ref = db.collection(COUNTER_COLLECTION).doc(`${providerId}-${year}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? Number(snap.data()?.next ?? 0) : 0) + 1;
    tx.set(ref, {providerId, year, next, updatedAt: new Date().toISOString()});
    return next;
  });
};

const drawPage = async (
  bill: Bill,
  invoiceNumber: string,
  provider: Record<string, unknown> | null,
  issuedAt: string,
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = fontBytes();
  const regular = await doc.embedFont(bytes.regular, {subset: true});
  const bold = await doc.embedFont(bytes.bold, {subset: true});
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const drawText = (
    value: string,
    x: number,
    at: number,
    size: number,
    font: PDFFont = regular,
    color = INK,
  ): void => {
    page.drawText(value, {x, y: at, size, font, color});
  };
  const drawRight = (
    value: string,
    right: number,
    at: number,
    size: number,
    font: PDFFont = regular,
    color = INK,
  ): void => {
    drawText(
      value,
      right - font.widthOfTextAtSize(value, size),
      at,
      size,
      font,
      color,
    );
  };
  const drawRule = (
    at: number,
    color = LINE,
    thickness = 0.7,
    x = MARGIN,
    width = CONTENT_WIDTH,
  ): void => {
    page.drawLine({
      start: {x, y: at},
      end: {x: x + width, y: at},
      thickness,
      color,
    });
  };

  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 6,
    width: PAGE_WIDTH,
    height: 6,
    color: BRAND,
  });
  const headerTop = PAGE_HEIGHT - 44;
  drawText("RoadAssist", MARGIN, headerTop, 22, bold, BRAND);
  drawText("Trip invoice", MARGIN, headerTop - 16, 9, regular, MUTED);
  drawRight("INVOICE", AMOUNT_RIGHT, headerTop, 26, bold, INK);
  drawRight(
    `No. ${invoiceNumber}`,
    AMOUNT_RIGHT,
    headerTop - 22,
    10,
    bold,
    INK,
  );
  drawRight(
    `Issued ${dateLabel(issuedAt)}`,
    AMOUNT_RIGHT,
    headerTop - 36,
    9,
    regular,
    MUTED,
  );
  const pillWidth = 44;
  const pillHeight = 16;
  const pillY = headerTop - 60;
  page.drawRectangle({
    x: AMOUNT_RIGHT - pillWidth,
    y: pillY,
    width: pillWidth,
    height: pillHeight,
    color: PAID,
  });
  drawText("PAID", AMOUNT_RIGHT - pillWidth + 10, pillY + 5, 8, bold, WHITE);
  y = headerTop - 86;

  const item = bill.items[0];
  page.drawRectangle({
    x: MARGIN,
    y: y - 44,
    width: CONTENT_WIDTH,
    height: 44,
    color: BAND,
  });
  const cellWidth = CONTENT_WIDTH / 4;
  const meta: Array<[string, string]> = metaRowsFor(bill, item);
  meta.forEach(([label, value], index) => {
    const x = MARGIN + index * cellWidth;
    drawText(label, x + 8, y - 8, 7, bold, MUTED);
    drawText(clipText(value, regular, 8.5, cellWidth - 16), x + 8, y - 28, 8.5);
  });
  y -= 60;

  const providerParty = item?.provider;
  const riderParty = item?.rider;
  const providerName = providerNameFor(providerParty, provider);
  const providerAddress = providerAddressFor(providerParty, provider);
  const taxCode = taxCodeFor(provider);
  const providerPhone = providerParty?.phone ?? "";
  const riderName = riderParty?.name ?? "Rider";
  const riderPhone = riderParty?.phone ?? "";

  const partyLines = (
    name: string,
    details: Array<{value: string; font: PDFFont; size: number}>,
  ): Array<{text: string; font: PDFFont; size: number}> => [
    ...wrap(name, bold, 11, COLUMN_WIDTH)
      .map((text) => ({text, font: bold, size: 11})),
    ...details.flatMap((detail) =>
      wrap(detail.value, detail.font, detail.size, COLUMN_WIDTH)
        .map((text) => ({text, font: detail.font, size: detail.size}))),
  ];
  const providerLines = partyLines(providerName, [
    ...(providerAddress !== "" ?
      [{value: providerAddress, font: regular, size: 9}] : []),
    ...(taxCode !== "" ?
      [{value: `Tax code: ${taxCode}`, font: regular, size: 9}] : []),
    ...(providerPhone !== "" ?
      [{value: `Phone: ${providerPhone}`, font: regular, size: 9}] : []),
  ]);
  const riderLines = partyLines(riderName, [
    ...(riderPhone !== "" ?
      [{value: `Phone: ${riderPhone}`, font: regular, size: 9}] : []),
  ]);

  drawText("PROVIDER", MARGIN, y, 8, bold, MUTED);
  drawText("RIDER", RIGHT_COLUMN_X, y, 8, bold, MUTED);
  const partyTop = y - 15;
  const partyCount = Math.max(providerLines.length, riderLines.length);
  providerLines.forEach((line, index) => {
    drawText(line.text, MARGIN, partyTop - index * 13, line.size, line.font);
  });
  riderLines.forEach((line, index) => {
    drawText(
      line.text,
      RIGHT_COLUMN_X,
      partyTop - index * 13,
      line.size,
      line.font,
    );
  });
  y = partyTop - partyCount * 13 - 8;

  const drawTableHeader = (): void => {
    page.drawRectangle({
      x: MARGIN,
      y: y - 4,
      width: CONTENT_WIDTH,
      height: 20,
      color: BAND,
    });
    drawText("DESCRIPTION", MARGIN + 8, y + 2, 8, bold, MUTED);
    drawRight("QTY", QTY_RIGHT, y + 2, 8, bold, MUTED);
    drawRight("UNIT", UNIT_RIGHT, y + 2, 8, bold, MUTED);
    drawRight("AMOUNT", AMOUNT_RIGHT, y + 2, 8, bold, MUTED);
    y -= 20;
  };
  const startPage = (table: boolean): void => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    drawText("RoadAssist", MARGIN, y, 12, bold, BRAND);
    drawRight(`Invoice ${invoiceNumber}`, AMOUNT_RIGHT, y, 8, regular, MUTED);
    y -= 26;
    if (table) drawTableHeader();
  };

  drawTableHeader();
  const rows = item === undefined ? [] : rowsFor(item);
  for (const row of rows) {
    const lines = wrap(row.label, regular, 9, DESC_WIDTH);
    const height = Math.max(24, lines.length * 12 + 10);
    if (y - height < 230) startPage(true);
    const baseline = y - 14;
    lines.forEach((text, index) => {
      drawText(text, MARGIN, baseline - index * 12, 9);
    });
    drawRight(row.qty.toLocaleString("vi-VN"), QTY_RIGHT, baseline, 9);
    drawRight(money(row.unit), UNIT_RIGHT, baseline, 9);
    drawRight(money(row.amount), AMOUNT_RIGHT, baseline, 9);
    y -= height;
    drawRule(y + 4);
  }

  if (y < 240) startPage(false);
  y -= 20;

  const totals: Array<[string, number, boolean]> = totalsFor(bill, item);
  for (const [label, amount, strong] of totals) {
    drawText(label, AMOUNT_RIGHT - 210, y, 9, strong ? bold : regular,
      strong ? INK : MUTED);
    drawRight(money(amount), AMOUNT_RIGHT, y, 9, strong ? bold : regular, INK);
    y -= 14;
  }
  y -= 2;
  drawRule(y + 6);
  y -= 14;
  page.drawRectangle({
    x: AMOUNT_RIGHT - 230,
    y: y - 8,
    width: 230,
    height: 28,
    color: BAND,
  });
  drawText("Balance due", AMOUNT_RIGHT - 222, y + 2, 10, bold, INK);
  drawRight(money(bill.due), AMOUNT_RIGHT - 8, y + 1, 12, bold,
    bill.due > 0 ? BRAND : PAID);
  y -= 34;

  const paymentLine = paymentLineFor(item);
  if (paymentLine !== "") {
    drawText(`Payment: ${paymentLine}`, MARGIN, y, 8, regular, MUTED);
  }

  const pages = doc.getPages();
  const footer = "Internal receipt generated by RoadAssist. " +
    "Not a tax-authority e-invoice.";
  pages.forEach((sheet, index) => {
    sheet.drawLine({
      start: {x: MARGIN, y: 42},
      end: {x: AMOUNT_RIGHT, y: 42},
      thickness: 0.7,
      color: LINE,
    });
    sheet.drawText(footer, {
      x: MARGIN,
      y: 30,
      size: 8,
      font: regular,
      color: MUTED,
    });
    const label = `Page ${index + 1} of ${pages.length}`;
    sheet.drawText(label, {
      x: AMOUNT_RIGHT - regular.widthOfTextAtSize(label, 8),
      y: 30,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });
  return doc.save();
};

const bucketName = (): string => {
  if (typeof process.env.STORAGE_BUCKET === "string" &&
    process.env.STORAGE_BUCKET !== "") {
    return process.env.STORAGE_BUCKET;
  }
  try {
    const raw = JSON.parse(process.env.FIREBASE_CONFIG ?? "{}") as {
      storageBucket?: unknown;
    };
    if (typeof raw.storageBucket === "string" &&
      raw.storageBucket !== "") {
      return raw.storageBucket;
    }
  } catch {
    void 0;
  }
  const project = process.env.GCLOUD_PROJECT ??
    process.env.GCP_PROJECT ??
    "roadassistapp";
  return `${project}.appspot.com`;
};

const downloadUrl = (path: string, token: string): string => {
  const bucket = bucketName();
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/` +
    `${encodeURIComponent(path)}?alt=media&token=${token}`;
};

const ensureDownloadToken = async (
  path: string,
  token: string,
): Promise<void> => {
  const file = storage.bucket(bucketName()).file(path);
  const [metadata] = await file.getMetadata();
  const current = metadata.metadata?.firebaseStorageDownloadTokens;
  if (typeof current === "string" &&
    current.split(",").includes(token)) return;
  await file.setMetadata({
    metadata: {
      ...(metadata.metadata ?? {}),
      firebaseStorageDownloadTokens: token,
    },
  });
};

const generateInvoice = async (input: {
  userId: string;
  ticketId: string;
}): Promise<{
  invoiceId: string;
  number: string;
  url: string;
  expiresAt: string;
  status: string;
}> => {
  const bill = await billService.getBill({
    userId: input.userId,
    ticketId: input.ticketId,
  });
  if (bill.status !== "PAID" || bill.paid <= 0 || bill.due > 0) {
    throw new ValidationError("Only fully paid bills can be invoiced");
  }
  const ref = db.collection(INVOICE_COLLECTION).doc(bill.ticketId);
  const existing = await ref.get();
  const data = existing.exists ? existing.data() as {
    pdfPath?: string;
    number?: string;
    status?: string;
    downloadToken?: string;
    layoutVersion?: number;
    issuedAt?: string;
    providerId?: string;
    riderUid?: string;
  } : null;
  if (data !== null &&
    typeof data.pdfPath === "string" &&
    data.pdfPath !== "" &&
    data.layoutVersion === INVOICE_LAYOUT_VERSION) {
    const token = typeof data.downloadToken === "string" &&
      data.downloadToken !== "" ?
      data.downloadToken :
      randomBytes(12).toString("hex");
    await ensureDownloadToken(data.pdfPath, token);
    if (data.downloadToken !== token) {
      await ref.update({downloadToken: token});
    }
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
      .toISOString();
    return {
      invoiceId: ref.id,
      number: String(data.number ?? ""),
      url: downloadUrl(data.pdfPath, token),
      expiresAt,
      status: String(data.status ?? "ISSUED"),
    };
  }
  const item = bill.items[0];
  const providerId = item?.provider?.id ?? data?.providerId;
  if (providerId === undefined || providerId === "") {
    throw new NotFoundError("Invoice provider not found");
  }
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  const issuedAt = typeof data?.issuedAt === "string" && data.issuedAt !== "" ?
    data.issuedAt :
    new Date().toISOString();
  const issuedMs = Date.parse(issuedAt);
  const year = Number.isNaN(issuedMs) ?
    new Date().getFullYear() :
    new Date(issuedMs).getFullYear();
  let number = typeof data?.number === "string" ? data.number : "";
  if (number === "") {
    const sequence = await nextNumber(providerId, year);
    number = `INV-${year}-${String(sequence).padStart(6, "0")}`;
  }
  const pdf = await drawPage(
    bill,
    number,
    provider as unknown as Record<string, unknown>,
    issuedAt,
  );
  const path = typeof data?.pdfPath === "string" && data.pdfPath !== "" ?
    data.pdfPath :
    `invoices/${providerId}/${year}/${number}.pdf`;
  const downloadToken = randomBytes(12).toString("hex");
  const bucket = storage.bucket(bucketName());
  await bucket.file(path).save(Buffer.from(pdf), {
    contentType: "application/pdf",
    resumable: false,
    metadata: {
      metadata: {firebaseStorageDownloadTokens: downloadToken},
    },
  });
  const now = new Date().toISOString();
  await ref.set({
    id: ref.id,
    number,
    ticketId: bill.ticketId,
    providerId,
    riderUid: item?.rider?.uid ?? data?.riderUid ?? "",
    amount: bill.total,
    paid: bill.paid,
    taxCode: typeof provider.taxCode === "string" ? provider.taxCode : null,
    layoutVersion: INVOICE_LAYOUT_VERSION,
    status: data?.status ?? "ISSUED",
    pdfPath: path,
    downloadToken,
    issuedAt,
    updatedAt: now,
  }, {merge: true});
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  return {
    invoiceId: ref.id,
    number,
    url: downloadUrl(path, downloadToken),
    expiresAt,
    status: data?.status ?? "ISSUED",
  };
};

export {drawPage, generateInvoice, rowsFor};
