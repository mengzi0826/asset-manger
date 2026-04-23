#!/usr/bin/env node
// 扫描所有 securities 类资产，若 symbol 为空，则调用搜索 API
// 优先选取与资产币种一致的首个结果回填。运行后打印结果日志。

const BASE = process.env.BASE || "http://127.0.0.1:3000";

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[·•・\-_().,\[\]【】「」""'']/g, "");
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function main() {
  const { assets } = await fetchJson(`${BASE}/api/assets`);
  const targets = assets.filter(
    (a) => a.category_code === "securities" && !a.symbol
  );
  console.log(`待处理证券资产: ${targets.length}`);

  let ok = 0;
  let skip = 0;
  for (const a of targets) {
    const q = a.name.trim();
    try {
      const { items, error } = await fetchJson(
        `${BASE}/api/securities/search?q=${encodeURIComponent(q)}&limit=10`
      );
      if (error) console.warn(`  ! 搜索 ${q} 失败: ${error}`);
      if (!items || items.length === 0) {
        console.log(`  · 未找到: ${q}`);
        skip++;
        continue;
      }
      // 1) 币种一致且名称最相近优先
      const nq = normalize(q);
      const qUpperNoDot = q.trim().toUpperCase().replace(/\./g, "");
      const looksLikeCode = /^[A-Z0-9.\-]{1,8}$/i.test(q.trim());
      const scored = items.map((it) => {
        const nn = normalize(it.name);
        const codeUpperNoDot = it.code.toUpperCase().replace(/\./g, "");
        let score = 0;
        // code 精确匹配 query（忽略点号）——最高权重
        if (codeUpperNoDot === qUpperNoDot) score += 50;
        else if (looksLikeCode && codeUpperNoDot.startsWith(qUpperNoDot)) score += 5;
        if (it.currency === a.currency) score += 10;
        if (nn === nq) score += 8;
        else if (nn.startsWith(nq) || nq.startsWith(nn)) score += 4;
        else if (nn.includes(nq) || nq.includes(nn)) score += 2;
        // 优先主板代码：长度≤6 的纯字母/数字
        if (/^[A-Z]{1,5}$/.test(it.code)) score += 1;
        if (/^\d{5,6}$/.test(it.code)) score += 1;
        return { it, score };
      });
      scored.sort((x, y) => y.score - x.score);
      const pick = scored[0].it;
      if (pick.currency !== a.currency) {
        // 仅在货币一致时自动回填，避免误填
        const byCur = items.find((x) => x.currency === a.currency);
        if (!byCur) {
          console.log(
            `  · 跳过 ${q}（币种 ${a.currency} 没有匹配，候选首位 ${pick.code} ${pick.currency} ${pick.name}）`
          );
          skip++;
          continue;
        }
        const patchRes = await fetch(`${BASE}/api/assets/${a.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbol: byCur.code })
        });
        if (!patchRes.ok) {
          console.warn(`  ! 更新失败: ${q} -> ${byCur.code} ${patchRes.status}`);
          skip++;
        } else {
          console.log(`  ✓ ${q} -> ${byCur.code} (${byCur.name} / ${byCur.currency})`);
          ok++;
        }
      } else {
        const patchRes = await fetch(`${BASE}/api/assets/${a.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbol: pick.code })
        });
        if (!patchRes.ok) {
          console.warn(`  ! 更新失败: ${q} -> ${pick.code} ${patchRes.status}`);
          skip++;
        } else {
          console.log(`  ✓ ${q} -> ${pick.code} (${pick.name} / ${pick.currency})`);
          ok++;
        }
      }
    } catch (e) {
      console.warn(`  ! 异常 ${q}: ${e.message}`);
      skip++;
    }
    // 轻微节流，避免打爆东方财富
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`\n完成：成功 ${ok}，跳过 ${skip}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
