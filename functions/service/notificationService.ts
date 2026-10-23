import * as userRepository from "../repository/userRepository";
import {
  NOTIFICATION_PREF_DEFAULTS,
  NOTIFICATION_PREFS_FIELD,
  NotificationPrefs,
} from "../constants/notifications";
import {NotFoundError} from "../utils/errors";

const asBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const prefsFor = (value: unknown): NotificationPrefs => {
  const raw = value !== null && typeof value === "object" ?
    value as Record<string, unknown> :
    {};
  return {
    paymentUpdates: asBool(
      raw.paymentUpdates,
      NOTIFICATION_PREF_DEFAULTS.paymentUpdates,
    ),
    payoutUpdates: asBool(
      raw.payoutUpdates,
      NOTIFICATION_PREF_DEFAULTS.payoutUpdates,
    ),
  };
};

const requireUser = async (userId: string) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  return user;
};

const getPrefs = async (userId: string): Promise<NotificationPrefs> => {
  const user = await requireUser(userId);
  return prefsFor(user[NOTIFICATION_PREFS_FIELD]);
};

const updatePrefs = async ({
  userId,
  paymentUpdates,
  payoutUpdates,
}: {
  userId: string;
  paymentUpdates?: boolean;
  payoutUpdates?: boolean;
}): Promise<NotificationPrefs> => {
  const user = await requireUser(userId);
  const current = prefsFor(user[NOTIFICATION_PREFS_FIELD]);
  const next: NotificationPrefs = {
    paymentUpdates: asBool(paymentUpdates, current.paymentUpdates),
    payoutUpdates: asBool(payoutUpdates, current.payoutUpdates),
  };
  await userRepository.updateNotificationPrefs(userId, next);
  return next;
};

export {getPrefs, updatePrefs, prefsFor};
