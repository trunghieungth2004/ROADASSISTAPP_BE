import {db} from "../config/firebase";
import * as paymentRepository from "../repository/paymentRepository";
import * as platformConfigService from "./platformConfigService";
import * as sepayService from "./sepayService";
import {
  PAYMENT_ACTIVE_STATUSES,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from "../constants/payments";
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PURPOSE,
  subscriptionPlan,
} from "../constants/subscriptions";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";

const SUBSCRIPTION_PAYEE_ID = "PLATFORM";
const SUBSCRIPTION_PAYMENT_HISTORY = 50;

export type UserSubscription = {
  planId: string;
  status: "ACTIVE" | "EXPIRED";
  startedAt: string;
  expiresAt: string;
  lastPaymentId: string | null;
};

type StoredSubscription = {
  planId: string;
  startedAt: string;
  expiresAt: string;
  lastPaymentId: string | null;
  paymentIds: string[];
};

type SubscriptionPayment = paymentRepository.Payment & {
  checkout?: sepayService.SepayCheckoutFields;
  reused?: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ?
    value as Record<string, unknown> :
    {};

const stringField = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const storedSubscription = (raw: unknown): StoredSubscription | null => {
  const data = asRecord(raw);
  const planId = stringField(data.planId);
  const expiresAt = stringField(data.expiresAt);
  if (!planId || !expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
    return null;
  }
  const startedAt = stringField(data.startedAt) ?? expiresAt;
  const lastPaymentId = stringField(data.lastPaymentId);
  const paymentIds = Array.isArray(data.paymentIds) ?
    data.paymentIds.filter((id): id is string => typeof id === "string") :
    [];
  return {planId, startedAt, expiresAt, lastPaymentId, paymentIds};
};

const normalizeSubscription = (raw: unknown): UserSubscription | null => {
  const stored = storedSubscription(raw);
  if (!stored) return null;
  const active = Date.parse(stored.expiresAt) > Date.now();
  return {
    planId: stored.planId,
    status: active ? "ACTIVE" : "EXPIRED",
    startedAt: stored.startedAt,
    expiresAt: stored.expiresAt,
    lastPaymentId: stored.lastPaymentId,
  };
};

const listPlans = (): Array<{id: string; amount: number; days: number}> =>
  Object.values(SUBSCRIPTION_PLANS).map(({id, amount, days}) => ({
    id,
    amount,
    days,
  }));

const generateSubscriptionRef = (
  userId: string,
  planId: string,
): string => {
  const userPart = userId
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase();
  return `RA${userPart}${planId.slice(0, 1)}${stamp}`;
};

const activate = async ({
  uid,
  planId,
  paymentId,
}: {
  uid: string;
  planId: string;
  paymentId: string;
}): Promise<UserSubscription> => {
  const plan = subscriptionPlan(planId);
  if (!plan) throw new ValidationError("Unknown subscription plan");
  const now = new Date();
  const nowMs = now.getTime();
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    if (!doc.exists) throw new NotFoundError("User not found");
    const current = storedSubscription(doc.data()?.subscription);
    if (current?.paymentIds.includes(paymentId) ||
      current?.lastPaymentId === paymentId) {
      return normalizeSubscription(current) as UserSubscription;
    }
    const currentExpiry = current ? Date.parse(current.expiresAt) : NaN;
    const baseMs = Number.isFinite(currentExpiry) && currentExpiry > nowMs ?
      currentExpiry :
      nowMs;
    const startedAt = now.toISOString();
    const expiresAt = new Date(
      baseMs + plan.days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const paymentIds = [
      ...(current?.paymentIds ?? []),
      paymentId,
    ].slice(-SUBSCRIPTION_PAYMENT_HISTORY);
    const subscription = {
      planId: plan.id,
      status: "ACTIVE",
      startedAt,
      expiresAt,
      lastPaymentId: paymentId,
      paymentIds,
      updatedAt: startedAt,
    };
    tx.set(userRef, {subscription}, {merge: true});
    return normalizeSubscription(subscription) as UserSubscription;
  });
};

const activateFromPayment = async (
  payment: paymentRepository.Payment,
): Promise<UserSubscription | null> => {
  if (payment.purpose !== SUBSCRIPTION_PURPOSE) return null;
  const uid = stringField(payment.subscriptionUid);
  const planId = stringField(payment.subscriptionPlanId);
  if (!uid || !planId) {
    throw new ValidationError("Subscription payment is missing its plan");
  }
  const subscription = await activate({uid, planId, paymentId: payment.id});
  await paymentRepository.update(payment.id, {
    subscriptionActivatedAt: new Date().toISOString(),
  }).catch(() => undefined);
  await paymentRepository.clearGuard(payment.ticketId, payment.id)
    .catch(() => undefined);
  return subscription;
};

const createSubscriptionPayment = async ({
  userId,
  planId,
  method,
}: {
  userId: string;
  planId: string;
  method: string;
}): Promise<SubscriptionPayment> => {
  const plan = subscriptionPlan(planId);
  if (!plan) throw new ValidationError("Unknown subscription plan");
  if (method !== PAYMENT_METHOD.SEPAY) {
    throw new ValidationError("Subscriptions require SePay");
  }
  const config = await platformConfigService.getConfig();
  if (!config.paymentMethodsEnabled.includes(method)) {
    throw new ValidationError("Payment method is disabled");
  }
  const ticketId = `SUB-${userId}-${plan.id}`;
  const created = await paymentRepository.createGuarded({
    ticketId,
    riderUid: userId,
    payeeId: SUBSCRIPTION_PAYEE_ID,
    amount: plan.amount,
    method,
    qrRef: generateSubscriptionRef(userId, plan.id),
    status: PAYMENT_STATUS.PENDING,
    commissionRate: 0,
    commissionAmount: 0,
    payoutAmount: 0,
    purpose: SUBSCRIPTION_PURPOSE,
    subscriptionUid: userId,
    subscriptionPlanId: plan.id,
  });
  if (created.reused) {
    if (created.payment.method !== method) {
      throw new ConflictError("Subscription already has an active payment");
    }
    if (!PAYMENT_ACTIVE_STATUSES.includes(created.payment.status) ||
      created.payment.status !== PAYMENT_STATUS.PENDING) {
      return {...created.payment, reused: true};
    }
    return {
      ...created.payment,
      checkout: sepayService.buildCheckoutFields(created.payment),
      reused: true,
    };
  }
  return {
    ...created.payment,
    checkout: sepayService.buildCheckoutFields(created.payment),
    reused: false,
  };
};

export {
  activateFromPayment,
  createSubscriptionPayment,
  listPlans,
  normalizeSubscription,
};
