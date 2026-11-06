import {readFileSync} from "fs";
import {join} from "path";
import {randomBytes} from "crypto";
import fontkit from "@pdf-lib/fontkit";
import {PDFDocument, rgb, type PDFFont} from "pdf-lib";
import {db, storage} from "../config/firebase";
import * as billService from "./billService";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import {NotFoundError, ValidationError} from "../utils/errors";
import {PAYMENT_CURRENCY} from "../constants/payments";

const INVOICE_COLLECTION = "invoices";
const COUNTER_COLLECTION = "invoice_counters";
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 44;

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

const rowsFor = (item: BillItem): Row[] => {
  const services = (item.services ?? []).map((row) => ({
    label: row.name,
    qty: row.qty,
    unit: row.unitPrice,
    amount: row.amount,
  }));
  const extras = (item.extras ?? []).map((row) => ({
    label: `${row.name}${row.note ? ` (${row.note})` : ""}`,
    qty: row.qty,
    unit: row.unitPrice,
    amount: row.amount,
  }));
  const legacy = (item.items ?? []).map((row) => ({
    label: row.name,
    qty: row.qty,
    unit: row.unitPrice,
    amount: row.amount,
  }));
  const rows = [...services, ...extras, ...legacy];
  if (rows.length > 0) return rows;
  return [{
    label: item.kind === "TOW_FARE" ? "Tow fare" : "Repair service",
    qty: 1,
    unit: item.amount,
    amount: item.amount,
  }];
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
  rider: Record<string, unknown> | null,
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = fontBytes();
  const regular = await doc.embedFont(bytes.regular, {subset: true});
  const bold = await doc.embedFont(bytes.bold, {subset: true});
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const text = (
    value: string,
    x: number,
    size: number,
    font: PDFFont = regular,
    color = rgb(0.1, 0.1, 0.1),
  ): void => {
    page.drawText(value, {x, y, size, font, color});
  };

  text("RoadAssist", MARGIN, 22, bold, rgb(0.01, 0.52, 0.78));
  y -= 20;
  text("INVOICE", MARGIN, 12, bold);
  const issue = new Date();
  text(
    `No. ${invoiceNumber}`,
    PAGE_WIDTH - MARGIN - 180,
    10,
    bold,
  );
  y -= 14;
  text(
    `Issued: ${issue.toLocaleDateString("vi-VN")}`,
    PAGE_WIDTH - MARGIN - 180,
    9,
  );
  y -= 30;

  text("Provider", MARGIN, 11, bold);
  y -= 15;
  text(String(provider?.name ?? "RoadAssist provider"), MARGIN, 10);
  y -= 14;
  const label = typeof provider?.label === "string" ? provider.label : "";
  if (label !== "") {
    text(label, MARGIN, 9);
    y -= 13;
  }
  if (typeof provider?.taxCode === "string" && provider.taxCode !== "") {
    text(`Tax code: ${provider.taxCode}`, MARGIN, 9);
    y -= 13;
  }

  const riderName = typeof rider?.displayName === "string" ?
    rider.displayName :
    typeof rider?.email === "string" ? rider.email : "Rider";
  text("Rider", PAGE_WIDTH / 2, 11, bold);
  text(riderName, PAGE_WIDTH / 2, 10);
  y -= 30;

  const item = bill.items[0];
  const rows = item === undefined ? [] : rowsFor(item);
  text("Description", MARGIN, 9, bold);
  text("Qty", 360, 9, bold);
  text("Unit", 405, 9, bold);
  text("Amount", 475, 9, bold);
  y -= 8;
  page.drawLine({
    start: {x: MARGIN, y},
    end: {x: PAGE_WIDTH - MARGIN, y},
    thickness: 0.7,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 16;
  for (const row of rows) {
    const lines = wrap(row.label, regular, 9, 285);
    for (let i = 0; i < lines.length; i += 1) {
      if (y < 140) break;
      text(lines[i] ?? "", MARGIN, 9);
      if (i === 0) {
        text(String(row.qty), 360, 9);
        text(money(row.unit), 405, 9);
        text(money(row.amount), 475, 9);
      }
      y -= 13;
    }
    y -= 3;
  }
  y -= 10;
  page.drawLine({
    start: {x: MARGIN, y},
    end: {x: PAGE_WIDTH - MARGIN, y},
    thickness: 0.7,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 18;
  const total = bill.total;
  const deposit = item?.deposit?.amount ?? 0;
  const paid = bill.paid;
  const lines: Array<[string, number]> = [
    ["Total", total],
    ...(deposit > 0 ? [["Deposit credit", deposit] as [string, number]] : []),
    ["Paid", paid],
    ["Due", bill.due],
  ];
  for (const [labelText, amount] of lines) {
    text(labelText, 360, 10, bold);
    text(money(amount), 475, 10, bold);
    y -= 15;
  }
  text(
    "Internal receipt generated by RoadAssist. Not a tax-authority e-invoice.",
    MARGIN,
    8,
    regular,
    rgb(0.4, 0.4, 0.4),
  );
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
  if (existing.exists) {
    const data = existing.data() as {
      pdfPath?: string;
      number?: string;
      status?: string;
      downloadToken?: string;
    };
    if (typeof data.pdfPath === "string" && data.pdfPath !== "") {
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
  }
  const providerId = bill.items[0]?.provider?.id;
  if (providerId === undefined || providerId === "") {
    throw new NotFoundError("Invoice provider not found");
  }
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  const riderUid = bill.items[0]?.rider?.uid;
  const rider = riderUid === undefined || riderUid === "" ?
    null :
    await userRepository.findById(riderUid);
  const year = new Date().getFullYear();
  const sequence = await nextNumber(providerId, year);
  const number = `INV-${year}-${String(sequence).padStart(6, "0")}`;
  const pdf = await drawPage(
    bill,
    number,
    provider as unknown as Record<string, unknown>,
    rider as unknown as Record<string, unknown> | null,
  );
  const path = `invoices/${providerId}/${year}/${number}.pdf`;
  const downloadToken = randomBytes(12).toString("hex");
  const bucket = storage.bucket(bucketName());
  await bucket.file(path).save(Buffer.from(pdf), {
    contentType: "application/pdf",
    resumable: false,
    metadata: {
      metadata: {firebaseStorageDownloadTokens: downloadToken},
    },
  });
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await ref.set({
    id: ref.id,
    number,
    ticketId: bill.ticketId,
    providerId,
    riderUid: bill.items[0]?.rider?.uid ?? "",
    amount: bill.total,
    paid: bill.paid,
    taxCode: typeof provider.taxCode === "string" ? provider.taxCode : null,
    status: "ISSUED",
    pdfPath: path,
    downloadToken,
    issuedAt,
    updatedAt: issuedAt,
  });
  return {
    invoiceId: ref.id,
    number,
    url: downloadUrl(path, downloadToken),
    expiresAt,
    status: "ISSUED",
  };
};

export {generateInvoice};
