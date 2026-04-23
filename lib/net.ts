import { ProxyAgent, type Dispatcher } from "undici";

/**
 * 本机常见开发环境会开启 Clash/Surge 等代理（Fake-IP 模式）。
 * Node 原生 fetch/undici 默认不会读取系统代理，这里统一读取环境变量，
 * 只在需要访问外网行情/汇率接口时使用，不影响 Next.js 内部 fetch。
 */
let cached: Dispatcher | undefined;
let inited = false;

export function getProxyDispatcher(): Dispatcher | undefined {
  if (inited) return cached;
  inited = true;
  const proxy =
    process.env.FX_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  if (proxy) {
    try {
      cached = new ProxyAgent(proxy);
    } catch {
      cached = undefined;
    }
  }
  return cached;
}
