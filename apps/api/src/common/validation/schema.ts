import { AppError } from '../errors/app-error.js';

/**
 * 轻量严格校验器。
 *
 * 为什么自己写而不引 zod / class-validator：
 *   本工程为**离线内网交付**，依赖须在锁定版本内可审计；引入新依赖会触发
 *   供应链核验（依赖存在性 + 版本锚定），而校验逻辑本身不到 300 行，
 *   自持实现反而让「契约 -> 校验」这条链完全可见、可审计。
 *
 * 与契约对齐的关键点：
 *   契约里所有 requestBody 都标了 `additionalProperties: false`。
 *   本校验器的对象 schema 默认**严格**（拒绝未知键），
 *   这正是安全约束 #3「confirmedBy / confirmedAt 客户端传不进来」的落点 ——
 *   不是靠 service 层「忽略」该字段，而是**在入口就拒绝**整个请求。
 *
 * 错误收集策略：
 *   全部错误一次性收集完再抛出（而非首个错误即中断），
 *   前端据此高亮所有出错字段，不需要来回试错。
 */

export interface ValidationIssue {
  /** 字段路径，如 `items[2].action` */
  path: string;
  message: string;
}

export class ValidationFailure extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`参数校验失败：${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
    this.name = 'ValidationFailure';
    this.issues = issues;
  }
}

/** 校验上下文。同一请求内共享，issues 累积 */
interface Ctx {
  issues: ValidationIssue[];
}

export interface Schema<T> {
  /** 解析。失败时把问题记入 ctx 并返回 undefined（不抛异常） */
  parse(value: unknown, path: string, ctx: Ctx): T | undefined;
}

function push(ctx: Ctx, path: string, message: string): void {
  ctx.issues.push({ path, message });
}

function child(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path === '' ? key : `${path}.${key}`;
}

export const s = {
  string(opts: { min?: number; max?: number; pattern?: RegExp; patternHint?: string } = {}): Schema<string> {
    return {
      parse(value: unknown, path: string, ctx: Ctx): string | undefined {
        if (typeof value !== 'string') {
          push(ctx, path, '必须为字符串');
          return undefined;
        }
        let ok = true;
        if (opts.min !== undefined && value.length < opts.min) {
          push(ctx, path, `长度不得少于 ${opts.min}`);
          ok = false;
        }
        if (opts.max !== undefined && value.length > opts.max) {
          push(ctx, path, `长度不得超过 ${opts.max}`);
          ok = false;
        }
        if (opts.pattern && !opts.pattern.test(value)) {
          push(ctx, path, opts.patternHint ?? '格式不合法');
          ok = false;
        }
        return ok ? value : undefined;
      },
    };
  },

  number(opts: { min?: number; max?: number; integer?: boolean } = {}): Schema<number> {
    return {
      parse(value: unknown, path: string, ctx: Ctx): number | undefined {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          push(ctx, path, '必须为有限数字');
          return undefined;
        }
        let ok = true;
        if (opts.integer && !Number.isInteger(value)) {
          push(ctx, path, '必须为整数');
          ok = false;
        }
        if (opts.min !== undefined && value < opts.min) {
          push(ctx, path, `不得小于 ${opts.min}`);
          ok = false;
        }
        if (opts.max !== undefined && value > opts.max) {
          push(ctx, path, `不得大于 ${opts.max}`);
          ok = false;
        }
        return ok ? value : undefined;
      },
    };
  },

  boolean(): Schema<boolean> {
    return {
      parse(value: unknown, path: string, ctx: Ctx): boolean | undefined {
        if (typeof value !== 'boolean') {
          push(ctx, path, '必须为布尔值');
          return undefined;
        }
        return value;
      },
    };
  },

  enumOf<T extends string>(values: readonly T[]): Schema<T> {
    return {
      parse(value: unknown, path: string, ctx: Ctx): T | undefined {
        if (typeof value !== 'string' || !values.includes(value as T)) {
          push(ctx, path, `必须为 ${values.join(' / ')} 之一`);
          return undefined;
        }
        return value as T;
      },
    };
  },

  literal<T extends string | number | boolean>(expected: T): Schema<T> {
    return {
      parse(value: unknown, path: string, ctx: Ctx): T | undefined {
        if (value !== expected) {
          push(ctx, path, `必须为 ${String(expected)}`);
          return undefined;
        }
        return expected;
      },
    };
  },

  array<T>(item: Schema<T>, opts: { minItems?: number; maxItems?: number } = {}): Schema<T[]> {
    return {
      parse(value: unknown, path: string, ctx: Ctx): T[] | undefined {
        if (!Array.isArray(value)) {
          push(ctx, path, '必须为数组');
          return undefined;
        }
        let ok = true;
        if (opts.minItems !== undefined && value.length < opts.minItems) {
          push(ctx, path, `元素数不得少于 ${opts.minItems}`);
          ok = false;
        }
        if (opts.maxItems !== undefined && value.length > opts.maxItems) {
          push(ctx, path, `元素数不得超过 ${opts.maxItems}`);
          ok = false;
        }
        const out: T[] = [];
        value.forEach((raw, index) => {
          const parsed = item.parse(raw, child(path, index), ctx);
          if (parsed === undefined) {
            ok = false;
            return;
          }
          out.push(parsed);
        });
        return ok ? out : undefined;
      },
    };
  },

  /**
   * 对象 schema。
   *
   * `strict`（默认 true）拒绝未知键 —— 对应契约的 additionalProperties:false。
   * `partial` 允许全部键缺省（用于 query 参数这类可选集合）。
   */
  object<S extends Record<string, Schema<unknown>>>(
    shape: S,
    opts: { strict?: boolean; partial?: boolean } = {}
  ): Schema<{ [K in keyof S]: S[K] extends Schema<infer T> ? T : never }> {
    const strict = opts.strict ?? true;
    return {
      parse(value: unknown, path: string, ctx: Ctx) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          push(ctx, path, '必须为对象');
          return undefined;
        }
        const input = value as Record<string, unknown>;
        const known = new Set(Object.keys(shape));
        let ok = true;

        if (strict) {
          for (const key of Object.keys(input)) {
            if (!known.has(key)) {
              push(ctx, child(path, key), '为未定义字段，不接受客户端传入');
              ok = false;
            }
          }
        }

        const out: Record<string, unknown> = {};
        for (const [key, schema] of Object.entries(shape)) {
          const raw = input[key];
          const fieldPath = child(path, key);
          if (raw === undefined) {
            if (opts.partial) continue;
            push(ctx, fieldPath, '为必填字段');
            ok = false;
            continue;
          }
          const parsed = schema.parse(raw, fieldPath, ctx);
          if (parsed === undefined) {
            ok = false;
            continue;
          }
          out[key] = parsed;
        }
        return ok ? (out as { [K in keyof S]: S[K] extends Schema<infer T> ? T : never }) : undefined;
      },
    };
  },

  /** 可选字段：缺省时返回 undefined */
  optional<T>(inner: Schema<T>): Schema<T | undefined> {
    return {
      parse(value: unknown, path: string, ctx: Ctx): T | undefined {
        if (value === undefined) return undefined;
        return inner.parse(value, path, ctx);
      },
    };
  },

  /** 可为 null 的字段 */
  nullable<T>(inner: Schema<T>): Schema<T | null> {
    return {
      parse(value: unknown, path: string, ctx: Ctx): T | null | undefined {
        if (value === null) return null;
        return inner.parse(value, path, ctx);
      },
    };
  },

  /** 任意 JSON 值（用于未定型的 jsonb payload） */
  unknown(): Schema<unknown> {
    return {
      parse(value: unknown): unknown {
        return value;
      },
    };
  },

  /** 对象数组（jsonb 场景），同样拒绝未知键 */
  objectArray<S extends Record<string, Schema<unknown>>>(
    shape: S,
    opts: { maxItems?: number; minItems?: number } = {}
  ): Schema<Array<{ [K in keyof S]: S[K] extends Schema<infer T> ? T : never }>> {
    return s.array(s.object(shape), opts);
  },
};

/**
 * 校验并把失败转成 10001（参数错误）。
 *
 * 一次返回**全部**错误项，而非只报第一个 —— 前端据此高亮所有出错字段。
 */
export function parseOrThrow<T>(schema: Schema<T>, value: unknown, path = ''): T {
  const ctx: Ctx = { issues: [] };
  const parsed = schema.parse(value, path, ctx);
  if (ctx.issues.length > 0) {
    throw AppError.paramInvalid('请求参数不合法', { issues: ctx.issues });
  }
  // schema 已保证无 issue 时必定产出值；此处兜底防御类型系统无法表达的分支
  return parsed as T;
}
