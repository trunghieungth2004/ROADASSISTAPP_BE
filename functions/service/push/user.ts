import {messaging} from "../../config/firebase";
import * as fcmTokenRepository from "../../repository/fcmTokenRepository";

const sendUserPush = async (
  userId: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<void> => {
  try {
    const record = await fcmTokenRepository.findByUserId(userId);
    const tokens = (record?.tokens as string[] | undefined) ?? [];
    if (tokens.length === 0) return;
    await messaging.sendEach(tokens.map((token) => ({
      token,
      notification: {title, body},
      data,
    })));
  } catch {
    void 0;
  }
};

export {sendUserPush};
