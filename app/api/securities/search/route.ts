import { NextResponse } from "next/server";
import { fetch as undiciFetch } from "undici";
import { getProxyDispatcher } from "@/lib/net";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface SecuritySearchItem {
  /** 交易代码：600519 / 00700 / AAPL */
  code: string;
  /** 公司/标的中文或英文名 */
  name: string;
  /** 交易所：沪A / 深A / 港股 / NASDAQ / NYSE / AMEX / ... */
  exchange: string;
  /** 证券分类：AStock / HK / UsStock / Fund / Index / ... */
  classify: string;
  /** 证券类型说明：沪A / 港股 / 美股 / ETF / 基金 / ... */
  typeName: string;
  /** 推断的计价货币 */
  currency: "CNY" | "HKD" | "USD";
  /** 完整 QuoteID 方便后续拓展（例如抓行情） */
  quote_id: string;
}

interface EmSuggestItem {
  Code: string;
  Name: string;
  JYS: string;
  Classify: string;
  MarketType: string;
  SecurityTypeName: string;
  MktNum: string;
  QuoteID: string;
  UnifiedCode?: string;
}

interface EmSuggestResp {
  QuotationCodeTable?: {
    Data?: EmSuggestItem[] | null;
  };
}

function normalize(item: EmSuggestItem): SecuritySearchItem {
  const classify = item.Classify || "";
  const mkt = item.MktNum || "";
  let currency: SecuritySearchItem["currency"] = "CNY";
  if (classify.toLowerCase().includes("us") || mkt === "105" || mkt === "106" || mkt === "107") {
    currency = "USD";
  } else if (classify === "HK" || classify.toLowerCase().includes("hk") || mkt === "116") {
    currency = "HKD";
  }

  // 交易所展示名
  let exchange = item.JYS || "";
  if (mkt === "1") exchange = "沪市";
  else if (mkt === "0") exchange = "深市";
  else if (mkt === "116") exchange = "港交所";
  else if (mkt === "105") exchange = "NASDAQ";
  else if (mkt === "106") exchange = "NYSE";
  else if (mkt === "107") exchange = "AMEX";

  return {
    code: item.UnifiedCode || item.Code,
    name: item.Name,
    exchange,
    classify,
    typeName: item.SecurityTypeName || "",
    currency,
    quote_id: item.QuoteID
  };
}

function allowClassify(c: string): boolean {
  // 只保留常见的股票/ETF/基金/指数；过滤债券等
  const k = c.toLowerCase();
  return (
    k.includes("stock") ||
    k === "hk" ||
    k.includes("fund") ||
    k.includes("etf") ||
    k.includes("index") ||
    k.includes("astock")
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 10), 1), 20);
  if (!q) return NextResponse.json({ items: [] as SecuritySearchItem[] });

  const url = new URL("https://searchapi.eastmoney.com/api/suggest/get");
  url.searchParams.set("input", q);
  url.searchParams.set("type", "14"); // 股票/基金
  url.searchParams.set("count", String(limit));
  url.searchParams.set("_", String(Date.now()));

  try {
    const resp = await undiciFetch(url.toString(), {
      method: "GET",
      dispatcher: getProxyDispatcher(),
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        referer: "https://www.eastmoney.com/"
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!resp.ok) {
      return NextResponse.json(
        { items: [], error: `上游 ${resp.status}` },
        { status: 200 }
      );
    }
    const data = (await resp.json()) as EmSuggestResp;
    const raw = data?.QuotationCodeTable?.Data || [];
    const items = raw
      .filter((r) => r && r.Code && allowClassify(r.Classify || ""))
      .map(normalize)
      // 去重同 code
      .filter((it, i, arr) => arr.findIndex((x) => x.code === it.code) === i)
      .slice(0, limit);
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json(
      { items: [], error: e?.message ?? "search failed" },
      { status: 200 }
    );
  }
}
