import { EnvHttpProxyAgent } from 'undici';

/**
 * P1-4: 统一代理支持 — 之前只有 openai.ts 手动读取 https_proxy/HTTP_PROXY 等环境变量并
 * 条件性注入 undici ProxyAgent，anthropic.ts 完全没有代理支持（同一部署环境下
 * Anthropic 提供商会连不上）。EnvHttpProxyAgent 自动读取 HTTP_PROXY/HTTPS_PROXY/NO_PROXY
 * （大小写均可），未配置代理时透明直连，因此两个适配器都可以无条件使用同一个单例 dispatcher，
 * 无需手写环境变量判断分支。
 */
let _dispatcher: EnvHttpProxyAgent | undefined;

export function getProxyDispatcher(): EnvHttpProxyAgent {
    if (!_dispatcher) {
        _dispatcher = new EnvHttpProxyAgent();
    }
    return _dispatcher;
}
