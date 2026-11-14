import type {DispatchTicket} from "../../repository/dispatchRepository";
import {STATUS_DISPATCH} from "../../constants/status";
import {TOW_FARE, TOW_FARE_NIGHT_MULT} from "../../constants/dispatch";

type BreakdownCode =
  | "BASE"
  | "DISTANCE"
  | "WAITING"
  | "PRIOR_TOW"
  | "NIGHT"
  | "CEILING"
  | "ADJUSTMENT"
  | "ROUNDING"
  | "TRAVELED"
  | "CALLOUT"
  | "TRAVEL"
  | "REPAIR"
  | "PRIOR_VISIT"
  | "VISIT";

type BreakdownLine = {
  code: BreakdownCode;
  label: string;
  amount: number;
  detail: string | null;
};

const round1k = (value: number): number => Math.round(value / 1000) * 1000;

const includedKmFor = (
  vehicleClass: string | null,
  stored: number | null,
): number | null => {
  if (stored !== null) return stored;
  if (vehicleClass === "CAR") return TOW_FARE.CAR.includedKm;
  if (vehicleClass === "SOLO_BIKE") return TOW_FARE.SOLO_BIKE.includedKm;
  return null;
};

const waitMinutes = (ticket: DispatchTicket): number | null => {
  const waiting = ticket.waiting;
  if (!waiting || typeof waiting !== "object") return null;
  const startedAt = typeof waiting.startedAt === "string" ?
    Date.parse(waiting.startedAt) :
    NaN;
  if (!Number.isFinite(startedAt)) return null;
  const endedRaw = typeof waiting.endedAt === "string" ? waiting.endedAt : "";
  const endedAt = Date.parse(endedRaw);
  const end = Number.isFinite(endedAt) ? endedAt : Date.now();
  return Math.max(0, Math.round((end - startedAt) / 60000));
};

const towDistanceDetail = (
  distanceKm: number | null,
  billableKm: number | null,
  includedKm: number | null,
  perKmFee: number | null,
): string | null => {
  const shownKm = billableKm ?? distanceKm;
  if (shownKm === null) return null;
  const rate = perKmFee === null ?
    "" :
    ` × ${perKmFee.toLocaleString("vi-VN")} ₫/km`;
  const route = billableKm === null || distanceKm === null ?
    "" :
    ` · loaded ${distanceKm.toFixed(2)} km · ` +
    `first ${includedKm ?? 0} km included`;
  return `${shownKm.toFixed(2)} km${rate}${route}`;
};

type TowFareSnapshot = {
  fare: Record<string, unknown> | null;
  baseFee: number;
  perKmFee: number | null;
  includedKm: number | null;
  night: boolean;
  nightMultiplier: number | null;
  ceiling: number | null;
  partial: boolean;
  waitingFee: number;
  distanceKm: number | null;
  billableKm: number | null;
  historyAmount: number;
};

const towFareSnapshot = (ticket: DispatchTicket): TowFareSnapshot => {
  const fare = ticket.towFare as Record<string, unknown> | null | undefined;
  const actual = ticket.towActual;
  const baseFee = typeof fare?.baseFee === "number" ? fare.baseFee : 0;
  const perKmFee = typeof fare?.perKmFee === "number" ? fare.perKmFee : null;
  const vehicleClass = typeof fare?.vehicleClass === "string" ?
    fare.vehicleClass :
    typeof ticket.vehicleClass === "string" ? ticket.vehicleClass : null;
  const includedKm = includedKmFor(
    vehicleClass,
    typeof fare?.includedKm === "number" ? fare.includedKm : null,
  );
  const night = fare?.night === true;
  const nightMultiplier = typeof fare?.nightMultiplier === "number" ?
    fare.nightMultiplier :
    night ? TOW_FARE_NIGHT_MULT : null;
  const ceiling = typeof fare?.ceiling === "number" ? fare.ceiling : null;
  const partial = fare?.partial === true;
  const waitingFee = typeof fare?.waitingFee === "number" ?
    fare.waitingFee :
    0;
  const loadedKm = typeof fare?.loadedKm === "number" ? fare.loadedKm : null;
  const actualKm = actual && typeof actual.actualKm === "number" ?
    actual.actualKm :
    null;
  const distanceKm = actualKm ?? loadedKm;
  const billableKm = typeof fare?.billableKm === "number" ?
    fare.billableKm :
    distanceKm !== null && includedKm !== null ?
      Math.max(0, Math.round((distanceKm - includedKm) * 100) / 100) : null;
  const history = Array.isArray(ticket.towFeeHistory) ?
    ticket.towFeeHistory : [];
  const historyAmount = history.reduce((sum, row) => {
    if (typeof row !== "object" || row === null) return sum;
    const value = (row as {amount?: unknown}).amount;
    return sum + (typeof value === "number" && value > 0 ? value : 0);
  }, 0);
  return {
    fare: fare ?? null,
    baseFee,
    perKmFee,
    includedKm,
    night,
    nightMultiplier,
    ceiling,
    partial,
    waitingFee,
    distanceKm,
    billableKm,
    historyAmount,
  };
};

const waitingLine = (
  ticket: DispatchTicket,
  waitingFee: number,
): BreakdownLine => {
  const minutes = waitMinutes(ticket);
  return {
    code: "WAITING",
    label: "Waiting",
    amount: waitingFee,
    detail: minutes !== null ? `${minutes} min` : null,
  };
};

const partialLines = (
  ticket: DispatchTicket,
  amount: number,
  snapshot: TowFareSnapshot,
): BreakdownLine[] => {
  const lines: BreakdownLine[] = [{
    code: "TRAVELED",
    label: "Traveled distance",
    amount: Math.max(
      0,
      amount - snapshot.historyAmount - snapshot.waitingFee,
    ),
    detail: snapshot.distanceKm !== null ?
      `${snapshot.distanceKm.toFixed(2)} km` : null,
  }];
  if (snapshot.waitingFee > 0) {
    lines.push(waitingLine(ticket, snapshot.waitingFee));
  }
  return lines;
};

const normalLines = (
  ticket: DispatchTicket,
  amount: number,
  snapshot: TowFareSnapshot,
): BreakdownLine[] => {
  const lines: BreakdownLine[] = [];
  const distanceAmount = snapshot.perKmFee !== null &&
    snapshot.billableKm !== null ?
    round1k(snapshot.perKmFee * snapshot.billableKm) :
    Math.max(
      0,
      amount - snapshot.baseFee - snapshot.waitingFee -
      snapshot.historyAmount,
    );
  lines.push({
    code: "BASE",
    label: "Base fare",
    amount: snapshot.baseFee,
    detail: snapshot.includedKm !== null ?
      `includes first ${snapshot.includedKm} km` : null,
  });
  lines.push({
    code: "DISTANCE",
    label: "Distance",
    amount: distanceAmount,
    detail: towDistanceDetail(
      snapshot.distanceKm,
      snapshot.billableKm,
      snapshot.includedKm,
      snapshot.perKmFee,
    ),
  });
  if (snapshot.night) {
    const preNight = snapshot.baseFee +
      (snapshot.perKmFee !== null && snapshot.billableKm !== null ?
        snapshot.perKmFee * snapshot.billableKm :
        0);
    const nightAmount = snapshot.nightMultiplier !== null ?
      round1k((snapshot.nightMultiplier - 1) * preNight) :
      Math.max(0,
        amount - snapshot.baseFee - distanceAmount -
        snapshot.waitingFee - snapshot.historyAmount);
    if (nightAmount !== 0) {
      lines.push({
        code: "NIGHT",
        label: "Night surcharge",
        amount: nightAmount,
        detail: snapshot.nightMultiplier !== null ?
          `x${snapshot.nightMultiplier} on base + distance` : "night rate",
      });
    }
  }
  if (snapshot.waitingFee > 0) {
    lines.push(waitingLine(ticket, snapshot.waitingFee));
  }
  return lines;
};

const adjustmentLine = (
  amount: number,
  computed: number,
  ceiling: number | null,
): BreakdownLine | null => {
  const adjustment = amount - computed;
  if (adjustment === 0) return null;
  const capped = ceiling !== null && computed > ceiling &&
    Math.abs(amount - ceiling) <= 1;
  if (capped) {
    return {
      code: "CEILING",
      label: "Fare cap",
      amount: adjustment,
      detail: `capped at ${ceiling}`,
    };
  }
  if (Math.abs(adjustment) <= 500) {
    return {
      code: "ROUNDING",
      label: "Rounding",
      amount: adjustment,
      detail: "nearest 1,000 VND",
    };
  }
  return {
    code: "ADJUSTMENT",
    label: "Fare adjustment",
    amount: adjustment,
    detail: `final fare ${amount}`,
  };
};

const priorTowLines = (ticket: DispatchTicket): BreakdownLine[] => {
  const history = Array.isArray(ticket.towFeeHistory) ?
    ticket.towFeeHistory :
    [];
  const lines: BreakdownLine[] = [];
  for (const entry of history) {
    if (typeof entry !== "object" || entry === null) continue;
    const amount = typeof entry.amount === "number" ? entry.amount : 0;
    if (amount <= 0) continue;
    const deadheadKm = typeof entry.deadheadKm === "number" ?
      entry.deadheadKm :
      null;
    const loadedKm = typeof entry.loadedKm === "number" ?
      entry.loadedKm :
      null;
    const totalKm = deadheadKm === null && loadedKm === null ?
      null :
      (deadheadKm ?? 0) + (loadedKm ?? 0);
    const shopName = typeof entry.shopName === "string" &&
      entry.shopName !== "" ?
      entry.shopName :
      null;
    const detail = [
      totalKm !== null ? `${totalKm.toFixed(2)} km` : null,
      shopName,
    ].filter((part): part is string => part !== null).join(" · ");
    lines.push({
      code: "PRIOR_TOW",
      label: "Prior tower travel",
      amount,
      detail: detail !== "" ? detail : null,
    });
  }
  return lines;
};

const towBreakdown = (
  ticket: DispatchTicket,
  amount: number,
): {distanceKm: number | null; breakdown: BreakdownLine[]} => {
  const snapshot = towFareSnapshot(ticket);
  let breakdown = snapshot.partial ?
    partialLines(ticket, amount, snapshot) :
    snapshot.fare !== null ?
      normalLines(ticket, amount, snapshot) :
      [];
  if (snapshot.historyAmount > 0) {
    breakdown.push(...priorTowLines(ticket));
  }
  if (breakdown.length === 0) {
    breakdown.push({
      code: "VISIT",
      label: "Tow fare",
      amount,
      detail: null,
    });
  } else {
    const computed = breakdown.reduce((sum, row) => sum + row.amount, 0);
    const adjustment = adjustmentLine(amount, computed, snapshot.ceiling);
    if (adjustment !== null) breakdown = [...breakdown, adjustment];
  }
  return {distanceKm: snapshot.distanceKm, breakdown};
};

const sosBreakdown = (
  ticket: DispatchTicket,
  amount: number,
): BreakdownLine[] => {
  const breakdown: BreakdownLine[] = [];
  const callOut = typeof ticket.mobileCallOutFee === "number" ?
    ticket.mobileCallOutFee :
    0;
  const travel = typeof ticket.mobileTravelFee === "number" ?
    ticket.mobileTravelFee :
    0;
  const travelKm = typeof ticket.mobileTravelKm === "number" ?
    ticket.mobileTravelKm :
    null;
  const travelRate = typeof ticket.mobileTravelRate === "number" ?
    ticket.mobileTravelRate :
    null;
  const fix = typeof ticket.finalAmount === "number" ?
    ticket.finalAmount :
    0;
  const history = Array.isArray(ticket.mobileFeeHistory) ?
    ticket.mobileFeeHistory :
    [];
  const unfixable = ticket.status === STATUS_DISPATCH.UNFIXABLE ||
    ticket.status === STATUS_DISPATCH.RESOLVED_UNFIXABLE;
  for (const row of history) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const value = (typeof record.callOutFee === "number" ?
      record.callOutFee :
      0) + (typeof record.travelFee === "number" ? record.travelFee : 0);
    if (value <= 0) continue;
    breakdown.push({
      code: "PRIOR_VISIT",
      label: "Prior visit",
      amount: value,
      detail: "call-out + travel",
    });
  }
  if (callOut > 0) {
    breakdown.push({
      code: "CALLOUT",
      label: "Call-out",
      amount: callOut,
      detail: null,
    });
  }
  if (!unfixable && travel > 0) {
    breakdown.push({
      code: "TRAVEL",
      label: "Travel",
      amount: travel,
      detail: travelKm !== null && travelRate !== null ?
        `${travelKm.toFixed(2)} km × ` +
        `${travelRate.toLocaleString("vi-VN")} ₫/km` :
        null,
    });
  }
  if (!unfixable && fix > 0) {
    breakdown.push({
      code: "REPAIR",
      label: "Repair",
      amount: fix,
      detail: null,
    });
  }
  if (breakdown.length === 0) {
    breakdown.push({
      code: "VISIT",
      label: "Repair",
      amount,
      detail: null,
    });
  }
  return breakdown;
};

const breakdownFor = (
  ticket: DispatchTicket,
  amount: number,
): {distanceKm: number | null; breakdown: BreakdownLine[]} => {
  if (ticket.ticketType === "TOW") {
    return towBreakdown(ticket, amount);
  }
  if (ticket.ticketType === "SOS") {
    return {distanceKm: null, breakdown: sosBreakdown(ticket, amount)};
  }
  return {
    distanceKm: null,
    breakdown: [{
      code: "VISIT",
      label: "Repair (approved quote)",
      amount,
      detail: null,
    }],
  };
};

export {breakdownFor, includedKmFor};
export type {BreakdownCode, BreakdownLine};
