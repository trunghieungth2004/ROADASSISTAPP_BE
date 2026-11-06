import * as statusRepository from "../repository/statusRepository";
import {STATUS_NAMES_VI} from "../constants/status";

const GROUP_ORDER = ["users", "flags", "dispatch", "providers"];

const getStatuses = async () => {
  const statuses = await statusRepository.findAll();
  const grouped: Record<string, unknown[]> = {};
  for (const group of GROUP_ORDER) {
    const records = statuses
      .filter((s) => s.domain === group)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((record) => {
        const key = `${String(record.domain)}:${String(record.code)}`;
        const nameVi = STATUS_NAMES_VI[key];
        return {...record, ...(nameVi !== undefined ? {nameVi} : {})};
      });
    grouped[group] = records;
  }
  return grouped;
};

export {getStatuses};
