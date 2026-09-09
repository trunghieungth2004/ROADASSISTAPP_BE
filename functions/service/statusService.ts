import * as statusRepository from "../repository/statusRepository";

const GROUP_ORDER = ["users", "flags", "dispatch"];

const getStatuses = async () => {
  const statuses = await statusRepository.findAll();
  const grouped: Record<string, unknown[]> = {};
  for (const group of GROUP_ORDER) {
    const records = statuses
      .filter((s) => s.domain === group)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    grouped[group] = records;
  }
  return grouped;
};

export {getStatuses};
