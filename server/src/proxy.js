import { ProxyAgent, setGlobalDispatcher } from "undici";
import { envString } from "./env.js";

const DEFAULT_PRODUCTION_PROXY_URL = "http://127.0.0.1:7890";

export function configureProductionProxy() {
  if (process.env.NODE_ENV !== "production") return;

  const proxyUrl = envString("NODE_PROXY_URL", envString("HTTPS_PROXY", envString("HTTP_PROXY", DEFAULT_PRODUCTION_PROXY_URL)));
  if (!proxyUrl) return;

  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`Production Node fetch proxy enabled: ${proxyUrl}`);
}

