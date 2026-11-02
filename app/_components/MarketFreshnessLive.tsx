"use client";

import { useEffect, useState } from "react";
import { DataFreshnessLine, type DataFreshnessProps } from "./DataFreshness";

type Freshness = Omit<DataFreshnessProps, "hasSecurities">;

const POLL_MS = 60 * 1000;

export function MarketFreshnessLive({ initial }: { initial: Freshness }) {
  const [data, setData] = useState(initial);

  useEffect(() => {
    setData(initial);
  }, [
    initial.weekend,
    initial.fxConfigured,
    initial.fxLast,
    initial.fxError,
    initial.fxStale,
    initial.stocksConfigured,
    initial.stocksLast,
    initial.stocksError,
    initial.stocksStale
  ]);

  useEffect(() => {
    let timer = 0;
    const pull = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/market-freshness", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: Freshness | null) => {
          if (json) setData(json);
        })
        .catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    pull();
    timer = window.setInterval(pull, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <DataFreshnessLine {...data} />;
}
