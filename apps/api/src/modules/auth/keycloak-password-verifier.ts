import type { PasswordVerifier } from './auth.service.js';

/**
 * Keycloak 口令校验器。
 *
 * ## 为什么口令校验委托 Keycloak
 *
 * schema.sql 的 `users` 表**没有口令列**：
 *   > 口令**不存储**。Keycloak 26.8.1 承载认证，本字段仅存 Keycloak 的用户索引
 *
 * 因此 MedPlan 不做本地口令比对 —— 那要求 MedPlan 存口令哈希，
 * 等于多一份口令资产要保护（多一个地方泄露就多一次事故）。
 *
 * ## 校验方式
 *
 * 调用 Keycloak 的 OIDC token 端点做 Resource Owner Password 凭据流：
 * 口令正确时会返回 access_token；口令错误时返回 `invalid_grant`。
 * 我们只取「是否通过」这个布尔值，不消费令牌内容 ——
 * 令牌由前端直接从 Keycloak 换取（后端不代理令牌，避免令牌多一跳一跳）。
 *
 * ## 失败一律 false
 *
 * Keycloak 不可达、超时、返回异常格式，**都**算校验不通过。
 * 理由：把「IdP 挂了」当成「口令错误」会误导用户；
 * 但反过来把它当成「放行」更糟 —— 那等于 IdP 故障时任何口令都能登录。
 * 用户侧的提示由审计事件里的 result 与日志区分。
 */
export function createKeycloakPasswordVerifier(
  keycloakUrl: string,
  realm: string,
  clientId: string
): PasswordVerifier {
  const tokenUrl = `${keycloakUrl.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/token`;
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;

  return {
    async verify(loginName: string, password: string): Promise<boolean> {
      const body = new URLSearchParams({
        grant_type: 'password',
        client_id: clientId,
        username: loginName,
        password,
      });
      if (clientSecret) {
        body.set('client_secret', clientSecret);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: controller.signal,
        });
        // 200 = 口令正确（拿到令牌）；其余一律视为不通过
        return response.status === 200;
      } catch {
        // 网络错误 / 超时 -> 不通过（fail-closed）
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
