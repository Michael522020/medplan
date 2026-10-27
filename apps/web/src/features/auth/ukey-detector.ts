/**
 * UKey 检测。
 *
 * ## 为什么用 WebUSB 而不是 WebAuthn
 *
 * UKey 是硬件 USB Key，院内 CA 签发的 SM2 证书。检测「设备是否插着」
 * 这一件事，WebUSB 的 `navigator.usb.getDevices()` 是唯一可靠途径 ——
 * WebAuthn 只能证明「有一个已注册的凭据」，无法告诉医生「插没插」。
 *
 * 浏览器对 WebUSB 的支持：Chrome / Edge 86+（院内标准浏览器满足）。
 *
 * ## 证书读取
 *
 * 读取证书需要与 UKey 的具体实现协商。本模块只负责**探测设备存在性**
 * 与**读取一个通用描述符**，把「能否读到证书」交给调用方判断 ——
 * 不同厂商的 UKey 的证书存储位置差异很大，硬编码一种会锁死厂商。
 *
 * 真实部署时由院内 UKey 厂商提供的 WebUSB 描述符配置补齐。
 */

import { useCallback, useEffect, useState } from 'react';

/** UKey 探测状态。 */
export type UKeyProbeState =
  /** 尚未探测。 */
  | 'idle'
  /** 探测中。 */
  | 'probing'
  /** 已检测到 UKey。 */
  | 'present'
  /** 未检测到 UKey。 */
  | 'absent'
  /** 浏览器不支持 WebUSB。 */
  | 'unsupported'
  /** 探测出错。 */
  | 'error';

/** 探测结果。 */
export interface UKeyProbeResult {
  readonly state: UKeyProbeState;
  /** 设备序列号（若可读）。用于识别「插的是不是自己的那把」。 */
  readonly serialNumber?: string;
  /** 状态文案。面向医生，不暴露浏览器 API 细节。 */
  readonly message: string;
}

/** WebUSB 的最小类型声明。避免依赖 @types/w3c-web-usb（未安装）。 */
interface UsbDeviceLike {
  readonly serialNumber?: string;
  readonly productName?: string;
  readonly opened?: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
}

interface UsbNavigator {
  usb?: {
    getDevices(): Promise<UsbDeviceLike[]>;
    requestDevice(options: { filters: unknown[] }): Promise<UsbDeviceLike>;
  };
}

/** 获取可能存在的 WebUSB 接口。 */
function getUsb(): UsbNavigator['usb'] | undefined {
  if (typeof navigator === 'undefined') {
    return undefined;
  }
  return (navigator as unknown as UsbNavigator).usb;
}

/** 各状态对应的文案。 */
const STATE_MESSAGE: Record<UKeyProbeState, string> = {
  idle: '尚未检测 UKey',
  probing: '正在读取 UKey 数字证书…',
  present: '已检测到 UKey 数字证书',
  absent: '未检测到 UKey 数字证书，请插入后重试',
  unsupported: '当前浏览器不支持 UKey 读取，请使用院内标准浏览器（Chrome 113+ / Edge 113+）',
  error: '读取 UKey 数字证书失败，请重新插入后重试',
};

/**
 * 探测 UKey 是否已插入。
 *
 * @returns 探测结果。
 */
export async function probeUKey(): Promise<UKeyProbeResult> {
  const usb = getUsb();
  if (!usb) {
    return { state: 'unsupported', message: STATE_MESSAGE.unsupported };
  }

  try {
    const devices = await usb.getDevices();
    const device = devices[0];
    if (!device) {
      return { state: 'absent', message: STATE_MESSAGE.absent };
    }
    return {
      state: 'present',
      serialNumber: device.serialNumber,
      message: STATE_MESSAGE.present,
    };
  } catch (error) {
    console.warn('[auth] UKey 探测失败', error);
    return { state: 'error', message: STATE_MESSAGE.error };
  }
}

/** UKey 探测 Hook。 */
export interface UseUKeyProbeResult {
  readonly result: UKeyProbeResult;
  /** 重新探测。 */
  readonly refresh: () => void;
}

/**
 * UKey 探测 Hook。
 *
 * 页面挂载时探测一次，之后由调用方通过 `refresh()` 重新探测
 * （例如用户插入 UKey 后点击「重新检测」）。
 */
export function useUKeyProbe(autoProbe = true): UseUKeyProbeResult {
  const [result, setResult] = useState<UKeyProbeResult>({
    state: 'idle',
    message: STATE_MESSAGE.idle,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!autoProbe) {
      return;
    }
    let cancelled = false;
    setResult({ state: 'probing', message: STATE_MESSAGE.probing });
    void probeUKey().then((next) => {
      if (!cancelled) {
        setResult(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [autoProbe, nonce]);

  const refresh = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { result, refresh };
}

export { STATE_MESSAGE as UKEY_STATE_MESSAGE };
