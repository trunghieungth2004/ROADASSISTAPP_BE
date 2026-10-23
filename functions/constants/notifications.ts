const NOTIFICATION_PREFS_FIELD = "notificationPrefs";
const NOTIFICATION_CHANNEL = "payments";

type NotificationPrefs = {
  paymentUpdates: boolean;
  payoutUpdates: boolean;
};

const NOTIFICATION_PREF_DEFAULTS: NotificationPrefs = {
  paymentUpdates: true,
  payoutUpdates: true,
};

const PAYMENT_PUSH_EVENT = {
  OPENED: "PAYMENT_OPENED",
  RECEIVED: "PAYMENT_RECEIVED",
  CONFIRMED: "PAYMENT_CONFIRMED",
  REFUNDED: "PAYMENT_REFUNDED",
  PAYOUT: "PAYOUT_SETTLED",
} as const;

export {
  NOTIFICATION_PREFS_FIELD,
  NOTIFICATION_CHANNEL,
  NotificationPrefs,
  NOTIFICATION_PREF_DEFAULTS,
  PAYMENT_PUSH_EVENT,
};
