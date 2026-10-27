import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { signSessionToken } from '../../common/auth/jwt-verifier.js';
import type { ProfessionalTitle, RoleCode } from '../../common/auth/session.js';
import { AuthoritativeTimeService } from '../../common/time/authoritative-time.service.js';
import { AuthRepository } from './auth.repository.js';
import { UkeyVerifier } from './ukey-verifier.service.js';

/**
 * 认证业务逻辑。
 *
 * ## 双因素（等保三级 8.1.4.1）
 *
 * 契约明确：
 *   > 等保三级 8.1.4.1 要求两种及以上鉴别技术组合，且其中一种至少使用密码技术。
 *   > 本端点实现口令 + UKey SM2 数字证书。**短信验证码不可替代**（AC-02）。
 *
 * 因此**不存在**短信验证码的代码路径 —— 不是「可选开启」，
 * 而是没有这个能力。加一个短信验证码分支就等于给攻击者降级通道。
 */

/** 口令校验端口。生产实现对接 Keycloak 26.8.1 的 OIDC 端点 */
export interface PasswordVerifier {
  /**
   * 校验口令。
   *
   * @returns 是否通过
   */
  verify(loginName: string, password: string): Promise<boolean>;
}

/**
 * 口令校验器的 DI 令牌。
 *
 * 必须用**字符串令牌**而不是 interface 本身 ——
 * interface 在编译后被擦除，Nest 拿它当令牌会得到 undefined，
 * 报「The dependency at index [2] appears to be undefined at runtime」。
 */
export const PASSWORD_VERIFIER = 'PASSWORD_VERIFIER';

/** 认证服务配置项的 DI 令牌（原因同上） */
export const AUTH_CONFIG = 'AUTH_CONFIG';

export interface AuthServiceConfig {
  /** 会话令牌签名密钥 */
  sessionSecret: Buffer;
  /** 访问令牌有效期（秒） */
  accessTokenTtlSeconds: number;
  /** 刷新令牌有效期（秒） */
  refreshTokenTtlSeconds: number;
  /** 连续失败达该次数锁定账号 */
  lockThreshold: number;
  /** 锁定时长（分钟） */
  lockMinutes: number;
}

/** 登录成功后的会话载荷 */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  ntpOffsetMs: number;
  user: {
    userId: string;
    loginName: string;
    displayName: string;
    title: ProfessionalTitle;
    department: string;
    licenseNoMasked?: string;
    roles: RoleCode[];
  };
  ukey: {
    certSerial: string;
    subjectName: string;
    issuerName: string;
    validFrom: string;
    validTo: string;
    signatureAlgorithm: 'SM2';
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly ukeyVerifier: UkeyVerifier,
    @Inject(PASSWORD_VERIFIER) private readonly passwordVerifier: PasswordVerifier,
    private readonly timeService: AuthoritativeTimeService,
    @Inject(AUTH_CONFIG) private readonly config: AuthServiceConfig
  ) {}

  /**
   * 双因素登录。
   *
   * 流程：口令校验 -> UKey 证书链校验 -> UKey 绑定一致性 -> 签发会话。
   *
   * **失败路径一律返回同一个消息**（不区分口令错 / 证书过期 / 证书被吊销 /
   * 证书链断裂 / UKey 不匹配）。区分这些等于提供 oracle：
   * 攻击者可以据此判断某个证书序列号是否在院内注册过。
   */
  async login(input: {
    username: string;
    password: string;
    ukeyCert: string;
  }): Promise<LoginResult> {
    // 1. 查用户。用户不存在与口令错误返回同一个异常
    const user = await this.repository.findByLoginName(input.username);
    if (!user || !user.is_active) {
      throw invalidLogin();
    }

    // 2. 账号锁定检查（等保 8.1.4.1 鉴别失败处理）
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        '用户名、口令或 UKey 证书无效',
        423,
        undefined
      );
    }

    // 3. 口令校验（委托 Keycloak，MedPlan 不存储口令）
    const passwordOk = await this.passwordVerifier.verify(input.username, input.password);
    if (!passwordOk) {
      await this.repository.recordFailedLogin(
        user.id,
        this.config.lockThreshold,
        this.config.lockMinutes
      );
      throw invalidLogin();
    }

    // 4. UKey 证书链校验（有效期 -> 颁发者链 -> 吊销列表）
    const ukey = await this.ukeyVerifier.verify(input.ukeyCert);

    // 5. UKey 绑定一致性：同一用户必须始终使用同一张 UKey
    if (user.ukey_cert_serial && user.ukey_cert_serial !== ukey.certSerial) {
      await this.repository.recordFailedLogin(
        user.id,
        this.config.lockThreshold,
        this.config.lockMinutes
      );
      throw invalidLogin();
    }
    if (!user.ukey_cert_serial) {
      // 首次登录：绑定本次通过校验的 UKey
      await this.repository.bindUkeySerial(user.id, ukey.certSerial);
    }

    // 6. 登录成功
    await this.repository.recordSuccessfulLogin(user.id);
    const roles = (await this.repository.findRoles(user.id)) as RoleCode[];

    // 7. 权威时间与本机时钟的偏差。前端在偏移 > 1000ms 时提示医师检查系统时间
    const authoritative = await this.timeService.now();

    // 8. 签发会话。载荷含 ukey_cert_serial —— 会话本身即证明第二因素已完成
    const jti = randomUUID();
    const { token, expiresIn } = signSessionToken(
      {
        sub: user.id,
        dept: user.department_code,
        roles,
        ukeyCertSerial: ukey.certSerial,
        jti,
        expiresInSeconds: this.config.accessTokenTtlSeconds,
      },
      this.config.sessionSecret
    );

    return {
      accessToken: token,
      refreshToken: randomUUID(),
      tokenType: 'Bearer',
      expiresIn,
      ntpOffsetMs: Math.round(authoritative.offsetMs),
      user: {
        userId: user.id,
        loginName: user.login_name,
        displayName: user.display_name,
        title: toProfessionalTitle(user.title),
        department: user.department_code,
        licenseNoMasked: maskLicense(user.license_no_hash),
        roles,
      },
      ukey: {
        certSerial: ukey.certSerial,
        subjectName: ukey.cert.subject,
        issuerName: ukey.cert.issuer,
        validFrom: ukey.cert.validFrom.toISOString(),
        validTo: ukey.cert.validTo.toISOString(),
        signatureAlgorithm: 'SM2',
      },
    };
  }
}

/** 统一的登录失败异常 */
function invalidLogin(): AppError {
  return new AppError(
    ERROR_CODES.UNAUTHENTICATED,
    '用户名、口令或 UKey 证书无效',
    401,
    undefined
  );
}

/**
 * DB 职称 -> 契约枚举。
 *
 * `users.title` 是自由 varchar，DB 里没有 CHECK 约束。
 * 落库时若出现枚举外的值（如「主任药师」），映射到「其他」而不是抛错 ——
 * 登录不该因为一个职称拼写问题失败，但也不能把未知职称冒充成可签名职称。
 */
function toProfessionalTitle(raw: string): ProfessionalTitle {
  const titles: ProfessionalTitle[] = [
    '主任医师', '副主任医师', '主治医师', '住院医师', '医师', '技师', '护士', '其他',
  ];
  return titles.find((title) => title === raw) ?? '其他';
}

/**
 * 执业证书号掩码。
 *
 * `users.license_no_hash` 存的是 SM3 摘要（hex 64），**不可逆推**。
 * 因此无法从摘要还原真实证书号，也就无法生成真实的掩码值。
 *
 * 返回 undefined 而不是伪造一个掩码 —— 伪造的掩码值会被误当作真实数据
 * 显示给医师，是比「没有」更糟的结果。契约里该字段是 optional，
 * 缺失时前端不渲染即可。
 */
function maskLicense(_hash: string | null): string | undefined {
  return undefined;
}
