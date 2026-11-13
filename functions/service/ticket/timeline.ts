import type {DispatchTicket} from "../../repository/dispatchRepository";

type TicketTimelineEntry = {
  status: string;
  at: string;
  by: string | null;
};

const timelineFor = (
  ticket: DispatchTicket | null | undefined,
): TicketTimelineEntry[] => {
  if (!ticket || !Array.isArray(ticket.statusHistory)) return [];
  return ticket.statusHistory
    .filter((entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.status === "string" &&
      typeof entry.at === "string")
    .map((entry) => ({
      status: entry.status,
      at: entry.at,
      by: typeof entry.by === "string" ? entry.by : null,
    }))
    .sort((first, second) => first.at.localeCompare(second.at));
};

export {timelineFor, TicketTimelineEntry};
