import { getSetting } from "./db";

/** SQLite `setting` 表 key，在设置页中配置聚合数据 AppKey */
export const SETTING_JUHE_FX_APPKEY = "juhe_fx_appkey";
export const SETTING_JUHE_STOCK_APPKEY = "juhe_stock_appkey";

/**
 * 汇率「全球汇率查询换算」用 Key（不在代码中写死；可在设置中保存，或用环境变量覆盖）。
 * 环境变量供部署时注入，不提交到仓库。
 */
export function getJuheFxAppKey(): string {
  return (
    getSetting(SETTING_JUHE_FX_APPKEY)?.trim() ||
    process.env.JUHE_FX_APPKEY?.trim() ||
    ""
  );
}

/**
 * 「股票数据」用 Key，与汇率 Key 可分别配置。
 */
export function getJuheStockAppKey(): string {
  return (
    getSetting(SETTING_JUHE_STOCK_APPKEY)?.trim() ||
    process.env.JUHE_STOCK_APPKEY?.trim() ||
    ""
  );
}

export function keyDisplayHint(plain: string | null | undefined): {
  configured: boolean;
  /** 不暴露完整 key，只用于界面提示 */
  mask: string;
} {
  const v = (plain || "").trim();
  if (!v) return { configured: false, mask: "" };
  if (v.length <= 4) return { configured: true, mask: "****" };
  return { configured: true, mask: `****${v.slice(-4)}` };
}

export type KeyFieldSource = "database" | "env" | "none";

export interface KeyFieldState {
  mask: string;
  source: KeyFieldSource;
  effective_configured: boolean;
}

function buildKeyFieldState(
  settingKey: string,
  getEffective: () => string
): KeyFieldState {
  const stored = (getSetting(settingKey) || "").trim();
  if (stored) {
    return {
      mask: keyDisplayHint(stored).mask,
      source: "database",
      effective_configured: true
    };
  }
  if (getEffective() !== "") {
    return { mask: "", source: "env", effective_configured: true };
  }
  return { mask: "", source: "none", effective_configured: false };
}

export const getFxKeyFieldState = (): KeyFieldState =>
  buildKeyFieldState(SETTING_JUHE_FX_APPKEY, getJuheFxAppKey);

export const getStockKeyFieldState = (): KeyFieldState =>
  buildKeyFieldState(SETTING_JUHE_STOCK_APPKEY, getJuheStockAppKey);
