import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL } from '../../common/db/pool.js';
import { queryOne } from '../../common/db/pool.js';

/**
 * 认证数据访问。
 *
 * ## 口令不落库
 *
 * `users` 表**没有**口令列（schema.sql 明确：「口令**不存储**。
 * Keycloak 26.8.1 承载认证，本字段仅存 Keycloak 的用户索引」）。
 * 因此本 repository 只查用户身份与 UKey 绑定关系。
 */

export interface AuthUserRow {
  id: string;
  login_name: string;
  display_name: string;
  title: string;
  department_code: string;
  /** 已绑定的 UKey 证书序列号。为 null 表示该用户尚未绑定 UKey */
  ukey_cert_serial: string | null;
  is_active: boolean;
  /** 连续认证失败计数，达阈值锁定（等保 8.1.4.1 鉴别失败处理） */
  failed_login_count: number;
  /** 锁定截止时间 */
  locked_until: Date | null;
  license_no_hash: string | null;
}

/**
 * 按登录名查用户。
 *
 * 注意 `deleted_at IS NULL`：软删除的用户不可登录。
 */
@Injectable()
export class AuthRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async findByLoginName(loginName: string): Promise<AuthUserRow | undefined> {
    return queryOne<AuthUserRow>(
      this.pool,
      `SELECT id,
              login_name,
              display_name,
              title,
              department_code,
              ukey_cert_serial,
              is_active,
              failed_login_count,
              locked_until,
              license_no_hash
         FROM users
        WHERE login_name = $1
          AND deleted_at IS NULL`,
      [loginName]
    );
  }

  /** 取用户的角色编码 */
  async findRoles(userId: string): Promise<string[]> {
    const result = await this.pool.query<{ code: string }>(
      `SELECT r.code
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND (ur.expires_at IS NULL OR ur.expires_at > now())`,
      [userId]
    );
    return result.rows.map((row) => row.code);
  }

  /**
   * 记录一次登录失败。
   *
   * 连续失败达阈值后锁定账号（等保 8.1.4.1 鉴别失败处理：
   * 应提供鉴别失败处理功能，防止暴力破解）。
   */
  async recordFailedLogin(userId: string, lockThreshold: number, lockMinutes: number): Promise<void> {
    await this.pool.query(
      `UPDATE users
          SET failed_login_count = failed_login_count + 1,
              locked_until = CASE
                WHEN failed_login_count + 1 >= $2
                THEN now() + ($3 || ' minutes')::interval
                ELSE locked_until
              END
        WHERE id = $1`,
      [userId, lockThreshold, String(lockMinutes)]
    );
  }

  /** 登录成功：清零失败计数并记录登录时间 */
  async recordSuccessfulLogin(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE users
          SET failed_login_count = 0,
              locked_until = NULL,
              last_login_at = now()
        WHERE id = $1`,
      [userId]
    );
  }

  /**
   * 绑定 UKey 证书序列号。
   *
   * 首次登录时把本次通过校验的 UKey 序列号绑定到用户。
   * 之后登录必须使用**同一张** UKey —— 否则等于任何一张 UKey 都能登录，
   * 双因素就退化成了单因素。
   */
  async bindUkeySerial(userId: string, certSerial: string): Promise<void> {
    await this.pool.query(
      `UPDATE users
          SET ukey_cert_serial = $2
        WHERE id = $1
          AND (ukey_cert_serial IS NULL OR ukey_cert_serial = $2)`,
      [userId, certSerial]
    );
  }
}
