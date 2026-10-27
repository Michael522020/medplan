#!/usr/bin/env node
/**
 * 从 docs/openapi.yaml 生成 TypeScript 类型。
 *
 * 为什么不用 `openapi-typescript` 的 shell 包装：
 *   node_modules/.bin/ 下是 sh 包装脚本，在 Windows Git Bash 下会因
 *   shebang 与路径分隔符处理方式不同而失败。
 * 为什么不用库 API 直接 import：
 *   该包同时提供 ESM 与 CJS 入口，动态 import 时 default 会因互操作
 *   变成整个模块对象，取不到预期的生成函数。
 * 因此这里直接以子进程方式调用 CLI 的 Node 入口，跨平台行为一致，
 * 且失败时能拿到 CLI 自己的完整报错。
 *
 * 输出到 packages/contracts/src/generated/api-types.ts：
 *   契约类型是前后端共享资产，放进 contracts 包可被 apps/web 与 apps/api
 *   同时引用，避免根目录生成物与前端工程不同步。
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'docs', 'openapi.yaml');
const OUT_DIR = path.join(ROOT, 'packages', 'contracts', 'src', 'generated');
const OUT = path.join(OUT_DIR, 'api-types.ts');

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`找不到契约文件: ${INPUT}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let cliPath;
  try {
    cliPath = require.resolve('openapi-typescript/bin/cli.js');
  } catch {
    console.error('找不到 openapi-typescript，请先执行 npm install');
    process.exit(1);
  }

  const result = spawnSync(
    process.execPath,
    // 注意：不要加 --additional-properties。
    // 该标志会让生成的类型带上 [key: string]: unknown 索引签名，
    // 从而使 openapi.yaml 里 additionalProperties: false 的约束在类型层失效 ——
    // verify-types.ts 的 13 条 @ts-expect-error 负向断言会全部变成
    // 「未被使用」而报错，AI 合规边界的编译期保障被瓦解。
    [cliPath, INPUT, '-o', OUT, '--alphabetize'],
    { cwd: ROOT, encoding: 'utf8' }
  );

  if (result.status !== 0) {
    console.error('类型生成失败：');
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    process.exit(result.status || 1);
  }

  const size = fs.statSync(OUT).size;
  console.log(`已生成契约类型: ${path.relative(ROOT, OUT)} (${(size / 1024).toFixed(1)}KB)`);
}

main();
