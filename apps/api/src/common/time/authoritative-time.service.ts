import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';

/**
 * 权威时间源。
 *
 * ## 为什么签名必须用权威时间
 *
 * AC-15：「If NTP 时间偏移超阈值，系统**必须**拒绝签名且**不得**用本地时间兜底」。
 * 国卫办医发〔2017〕8 号第十一条同样要求电子签名使用权威可靠时间源。
 *
 * 理由很直接：签名时间是**法律事实**的一部分。若本机时钟可被随意调整，
 * 攻击者可以把签名时间改到任意时刻（伪造「医师在出院前签了字」这类情形）。
 * 因此：
 *
 *   1. 签名时间**只能**来自权威时间源（TSA / 北斗授时 / NTP）
 *   2. 本机时钟与权威时间的偏差超阈值 -> **拒绝签名**，而不是「用权威时间凑合」
 *      （凑合等于掩盖了本机时钟异常这台机器已经被篡改的事实）
 *
 * ## 本实现
 *
 * 通过 SNTP（RFC 4330）向配置的 NTP 服务器取权威时间。
 * 取不到时间 -> 抛 50002（签名服务不可达），**绝不退回本地时间**。
 *
 * SNTP 报文是 48 字节 UDP，协议简单到不需要第三方库：
 *   byte 0: LI(2bit) | VN(3bit) | Mode(3bit)  客户端 Mode=3
 *   byte 40-43: 接收时间戳（自 1900-01-01 起的秒数）
 *   byte 32-35: 发送时间戳（客户端发出时刻）
 *   byte 24-27: 服务器接收时间戳
 *   byte 48+:  服务器发出时刻（由服务器填写）
 */
export interface AuthoritativeTime {
  /** 权威时间（epoch 毫秒） */
  epochMs: number;
  /** 本机时钟与权威时间的偏差（毫秒）。正数表示本机慢 */
  offsetMs: number;
  /** 时间来源标识，写入签名日志备查 */
  source: string;
}

/** NTP 时间戳纪元（1900-01-01）与 Unix 纪元（1970-01-01）的秒差 */
const NTP_UNIX_EPOCH_DELTA_SECONDS = 2_208_988_800;

export interface NtpServer {
  host: string;
  port: number;
}

export interface AuthoritativeTimeConfig {
  servers: NtpServer[];
  /** 单次查询超时（毫秒） */
  timeoutMs: number;
  /** 签名允许的最大时钟偏差（秒）。契约：60 秒 */
  driftThresholdSeconds: number;
}

/** 从环境变量读取配置 */
export function loadTimeConfig(): AuthoritativeTimeConfig {
  const raw = process.env.NTP_SERVERS ?? '';
  const servers: NtpServer[] = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, port] = entry.split(':');
      return { host: host ?? 'ntp.aliyun.com', port: Number(port ?? 123) };
    });
  return {
    servers: servers.length > 0 ? servers : [{ host: 'ntp.aliyun.com', port: 123 }],
    timeoutMs: Number(process.env.NTP_TIMEOUT_MS ?? 3000),
    driftThresholdSeconds: Number(process.env.NTP_DRIFT_THRESHOLD_SECONDS ?? 60),
  };
}

/**
 * DI 令牌。interface 编译后被擦除，不能直接当 Nest 令牌用
 * （会得到 undefined，报 "dependency appears to be undefined at runtime"）。
 */
export const TIME_CONFIG = 'TIME_CONFIG';

/**
 * 权威时间服务。
 *
 * 用 Node 内建 `dgram` 发 SNTP 请求，不引入第三方 NTP 库。
 */
@Injectable()
export class AuthoritativeTimeService {
  constructor(@Inject(TIME_CONFIG) private readonly config: AuthoritativeTimeConfig) {}

  /**
   * 取权威时间并计算与本机时钟的偏差。
   *
   * @throws AppError 50002 全部 NTP 服务器不可达。**绝不**退回本地时间。
   */
  async now(): Promise<AuthoritativeTime> {
    const errors: string[] = [];
    for (const server of this.config.servers) {
      try {
        const authoritativeMs = await this.queryNtp(server);
        const localMs = Date.now();
        return {
          epochMs: authoritativeMs,
          offsetMs: localMs - authoritativeMs,
          source: `NTP:${server.host}:${server.port}`,
        };
      } catch (err) {
        errors.push(`${server.host}:${server.port} ${(err as Error).message}`);
      }
    }
    throw AppError.signatureServiceUnavailable(
      '权威时间源不可用，未产生任何签名数据，请稍后重试',
      { reason: 'ntp_unreachable', servers: errors }
    );
  }

  /**
   * 校验时钟偏差是否在允许范围内。
   *
   * 偏差超阈值 -> 抛 50002 并带 ClockDriftDetail（契约要求返回
   * driftSeconds 与 thresholdSeconds 供前端提示）。
   */
  async assertWithinDrift(): Promise<AuthoritativeTime> {
    const time = await this.now();
    const driftSeconds = Math.round(Math.abs(time.offsetMs) / 1000);
    if (driftSeconds > this.config.driftThresholdSeconds) {
      throw AppError.clockDrift(driftSeconds, this.config.driftThresholdSeconds);
    }
    return time;
  }

  /** 单次 SNTP 查询。返回权威时间（epoch 毫秒） */
  private queryNtp(server: NtpServer): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      // 懒加载 dgram：仅在真正需要取时间时建立 socket
      void import('node:dgram').then(({ createSocket }) => {
        const socket = createSocket('udp4');
        const packet = Buffer.alloc(48);
        // LI=0（无告警）, VN=4, Mode=3（客户端）
        packet[0] = (4 << 3) | 3;

        let settled = false;
        let timer: NodeJS.Timeout | undefined;

        const finish = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          try {
            socket.close();
          } catch {
            // socket 已关闭，忽略
          }
          fn();
        };

        timer = setTimeout(() => {
          finish(() => reject(new Error('请求超时')));
        }, this.config.timeoutMs);

        // 记录 T1（客户端发出时刻）并写入请求包的 transmit timestamp。
        // 必须在 message 回调注册**之前**赋值：回调是异步触发的，
        // 但若 socket 立即回包，闭包读取的必须是已赋值的值。
        const localTransmitSeconds = readTimestampSeconds(Date.now());
        writeTimestamp(packet, 40, localTransmitSeconds);

        socket.on('message', (message) => {
          if (message.length < 48) {
            finish(() => reject(new Error('响应长度非法')));
            return;
          }
          // Mode 必须为 4（服务器）；Layer 必须为 0
          const firstByte = message[0] ?? 0;
          const mode = firstByte & 0b111;
          const layer = firstByte & 0b11000;
          if (mode !== 4 || layer !== 0) {
            finish(() => reject(new Error('响应类型非法')));
            return;
          }

          // SNTP 四时间戳：
          //   T1 = 客户端发出（本机时钟）—— 写入请求包 offset 40
          //   T2 = 服务器收到（服务器时钟）—— 响应包 offset 32
          //   T3 = 服务器发出（服务器时钟）—— 响应包 offset 40
          //   T4 = 客户端收到（本机时钟）—— 本地读取
          const t1 = localTransmitSeconds;
          const t2 = readTimestamp(message, 32);
          const t3 = readTimestamp(message, 40);
          const t4 = readTimestampSeconds(Date.now());

          // 往返时延的一半，用于把 T3 外推到 T4 时刻
          const delta = ((t4 - t1) - (t3 - t2)) / 2;

          // T4 时刻的服务器权威时间（Unix 纪元毫秒）
          const serverTimeAtT4 = (t3 + delta - NTP_UNIX_EPOCH_DELTA_SECONDS) * 1000;
          finish(() => resolve(serverTimeAtT4));
        });

        socket.on('error', (err) => {
          finish(() => reject(err));
        });

        socket.send(packet, server.port, server.host, (err) => {
          if (err) {
            finish(() => reject(err));
          }
        });
      }).catch((err: Error) => {
        reject(err);
      });
    });
  }
}

/** 读取 NTP 48 字节报文中的 32 位时间戳（返回「自 1900 纪元起的秒数」） */
function readTimestamp(packet: Buffer, offset: number): number {
  const seconds = packet.readUInt32BE(offset);
  const fraction = packet.readUInt32BE(offset + 4) / 0x100000000;
  return seconds + fraction;
}

/** 把 Unix 纪元毫秒转成「自 1900 纪元起的秒数」 */
function readTimestampSeconds(epochMs: number): number {
  return epochMs / 1000 + NTP_UNIX_EPOCH_DELTA_SECONDS;
}

/** 写入 NTP 32 位时间戳 */
function writeTimestamp(packet: Buffer, offset: number, seconds: number): void {
  const whole = Math.floor(seconds);
  const fraction = Math.round((seconds - whole) * 0x100000000);
  packet.writeUInt32BE(whole >>> 0, offset);
  packet.writeUInt32BE(fraction >>> 0, offset + 4);
}
