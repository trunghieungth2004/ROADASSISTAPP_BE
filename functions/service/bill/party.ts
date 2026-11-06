import * as providerRepository from "../../repository/providerRepository";
import * as userRepository from "../../repository/userRepository";
import type {DispatchTicket} from "../../repository/dispatchRepository";

type BillParty = {
  rider: {uid: string; name: string; phone: string | null} | null;
  provider: {
    id: string;
    name: string;
    kind: string;
    phone: string | null;
    label: string | null;
  } | null;
};

type PartyCache = {
  mask: boolean;
  users: Map<string, Record<string, unknown> | null>;
  providers: Map<string, Record<string, unknown> | null>;
};

const userIn = async (
  cache: PartyCache,
  id: string,
): Promise<Record<string, unknown> | null> => {
  const known = cache.users.get(id);
  if (known !== undefined) return known;
  const user = await userRepository.findById(id) as unknown as
    Record<string, unknown> | null;
  cache.users.set(id, user);
  return user;
};

const providerIn = async (
  cache: PartyCache,
  id: string,
): Promise<Record<string, unknown> | null> => {
  const known = cache.providers.get(id);
  if (known !== undefined) return known;
  const provider = await providerRepository.findById(id) as unknown as
    Record<string, unknown> | null;
  cache.providers.set(id, provider);
  return provider;
};

const partyDetailsFor = async (
  ticket: DispatchTicket,
  cache: PartyCache,
): Promise<BillParty> => {
  const riderRecord = await userIn(cache, ticket.userId);
  const riderName = typeof riderRecord?.displayName === "string" &&
    riderRecord.displayName !== "" ?
    riderRecord.displayName :
    typeof riderRecord?.email === "string" ? riderRecord.email : "Rider";
  const riderPhone = cache.mask ? null :
    typeof riderRecord?.phone === "string" ? riderRecord.phone : null;
  const providerId = [
    ticket.assignedShopId,
    ticket.providerId,
    ticket.destinationShopId,
  ].find((value): value is string =>
    typeof value === "string" && value !== "");
  const providerRecord = providerId === undefined ?
    null :
    await providerIn(cache, providerId);
  let phone: string | null = null;
  if (!cache.mask && providerRecord &&
    typeof providerRecord.operatorUid === "string") {
    const operator = await userIn(cache, providerRecord.operatorUid);
    phone = typeof operator?.phone === "string" ? operator.phone : null;
  }
  return {
    rider: {
      uid: ticket.userId,
      name: riderName,
      phone: riderPhone,
    },
    provider: providerRecord === null ? null : {
      id: providerId as string,
      name: typeof providerRecord.name === "string" ?
        providerRecord.name :
        "",
      kind: typeof providerRecord.kind === "string" ?
        providerRecord.kind :
        "",
      phone,
      label: typeof providerRecord.label === "string" ?
        providerRecord.label :
        null,
    },
  };
};

export {partyDetailsFor};
export type {PartyCache, BillParty};
