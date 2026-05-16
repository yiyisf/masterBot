/** Admin Console 共享工具 */

export const ADMIN_KEY_STORAGE = "cmaster_admin_key";
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

/** 从 localStorage 读取 Admin Key（SSR 安全） */
export function getAdminKey(): string {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
}

/** 携带 X-Admin-Key 的 fetch 快捷方法 */
export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
            "X-Admin-Key": getAdminKey(),
            ...(init?.body ? { "Content-Type": "application/json" } : {}),
            ...init?.headers,
        },
    });
}
