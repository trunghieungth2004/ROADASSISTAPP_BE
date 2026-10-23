const REPORT_DEFAULT_DAYS = 30;
const REPORT_LIST_MAX = 5000;
const REPORT_CSV_MIME = "text/csv; charset=utf-8";
const REPORT_FORMAT = {
  JSON: "json",
  CSV: "csv",
} as const;

export {
  REPORT_DEFAULT_DAYS,
  REPORT_LIST_MAX,
  REPORT_CSV_MIME,
  REPORT_FORMAT,
};
