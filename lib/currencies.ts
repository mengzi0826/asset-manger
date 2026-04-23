export const SUPPORTED_CURRENCIES = ["CNY", "USD", "HKD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
