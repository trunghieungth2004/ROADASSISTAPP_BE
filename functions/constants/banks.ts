const VIETNAM_BANKS = [
  {code: "VCB", name: "Vietcombank", bin: "970436"},
  {code: "TCB", name: "Techcombank", bin: "970407"},
  {code: "MB", name: "MB Bank", bin: "970422"},
  {code: "TPB", name: "TPBank", bin: "970423"},
  {code: "VPB", name: "VPBank", bin: "970432"},
  {code: "ACB", name: "ACB", bin: "970416"},
  {code: "BIDV", name: "BIDV", bin: "970418"},
  {code: "VBA", name: "Agribank", bin: "970405"},
  {code: "STB", name: "Sacombank", bin: "970403"},
  {code: "SHB", name: "SHB", bin: "970443"},
  {code: "VIB", name: "VIB", bin: "970441"},
  {code: "HDB", name: "HDBank", bin: "970437"},
  {code: "OCB", name: "OCB", bin: "970448"},
  {code: "MSB", name: "MSB", bin: "970426"},
  {code: "SEAB", name: "SeABank", bin: "970440"},
  {code: "EIB", name: "Eximbank", bin: "970431"},
  {code: "LPB", name: "LPBank", bin: "970449"},
  {code: "CTG", name: "VietinBank", bin: "970415"},
  {code: "SCB", name: "SCB", bin: "970429"},
  {code: "NCB", name: "NCB", bin: "970419"},
  {code: "PVCB", name: "PVcomBank", bin: "970412"},
  {code: "SGB", name: "Saigonbank", bin: "970400"},
  {code: "KLB", name: "KienLongBank", bin: "970452"},
  {code: "BAB", name: "Bac A Bank", bin: "970409"},
  {code: "NAB", name: "Nam A Bank", bin: "970428"},
  {code: "PGB", name: "PGBank", bin: "970430"},
  {code: "ABB", name: "ABBank", bin: "970425"},
  {code: "VIETBANK", name: "VietBank", bin: "970433"},
  {code: "CBB", name: "CBBank", bin: "970444"},
  {code: "OCEANBANK", name: "Oceanbank", bin: "970414"},
  {code: "GPB", name: "GPBank", bin: "970408"},
  {code: "DAB", name: "DongA Bank", bin: "970406"},
  {code: "SHINHAN", name: "Shinhan Bank", bin: "970424"},
  {code: "WOORI", name: "Woori Bank", bin: "970457"},
  {code: "UOB", name: "UOB", bin: "970458"},
  {code: "CIMB", name: "CIMB", bin: "970459"},
  {code: "KOOKMIN", name: "Kookmin Bank", bin: "970463"},
  {code: "PBVN", name: "Public Bank Vietnam", bin: "970439"},
  {code: "IVB", name: "Indovina Bank", bin: "970434"},
  {code: "BVB", name: "BaoViet Bank", bin: "970438"},
  {code: "COOPBANK", name: "CoopBank", bin: "970446"},
  {code: "HANA", name: "KEB Hana Bank", bin: "970467"},
  {code: "VRB", name: "VRB", bin: "970421"},
] as const;

type VietnamBank = {code: string; name: string; bin: string};

const BANK_BY_CODE = new Map<string, VietnamBank>(
  VIETNAM_BANKS.map((bank) => [bank.code, bank] as [string, VietnamBank]),
);

const ACCOUNT_NUMBER_PATTERN = /^\d{6,19}$/;
const HOLDER_NAME_PATTERN = /^[A-Za-zÀ-ỹ0-9 .'-]{2,80}$/;

export {
  VietnamBank,
  VIETNAM_BANKS,
  BANK_BY_CODE,
  ACCOUNT_NUMBER_PATTERN,
  HOLDER_NAME_PATTERN,
};
