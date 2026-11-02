export type SubscriptionPlan = {
  id: string;
  amount: number;
  days: number;
};

const SUBSCRIPTION_PURPOSE = "SUBSCRIPTION";

const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlan> = {
  WEEKLY: {id: "WEEKLY", amount: 40000, days: 7},
  MONTHLY: {id: "MONTHLY", amount: 200000, days: 30},
  YEARLY: {id: "YEARLY", amount: 1500000, days: 365},
};

const SUBSCRIPTION_PLAN_IDS = Object.keys(SUBSCRIPTION_PLANS);

const subscriptionPlan = (planId: string): SubscriptionPlan | null =>
  SUBSCRIPTION_PLANS[planId] ?? null;

export {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PURPOSE,
  subscriptionPlan,
};
