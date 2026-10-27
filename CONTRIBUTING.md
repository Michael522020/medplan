# 贡献指南

感谢参与 MedPlan。

## 项目定位

企业级医学影像阅片与手术规划系统。**开源的目的是分享「合规怎么落地」的方法**，
而不是提供一个可以直接部署上线的完整医疗系统。

> ⚠️ **重要声明**
> 本项目是**工程实现与设计参考**，不是医疗器械，也不用于临床诊断。
> 任何部署使用前，必须自行完成等保测评、密评、器械注册（如涉及）、
> 以及所在司法辖区的全部合规审查。开源许可**不构成**任何合规或临床适用性承诺。

## 开发前置

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | **22.x（>=22.12.0，<23）** | Vite 8 要求 >=22.12.0。**不要升到 24** —— 见 `docs/decisions/ADR-008.md` |
| npm | >=10 | 随 Node 22 附带 |
| PostgreSQL | 18 | 跑数据库相关测试时需要 |

## 常用命令

```bash
npm ci                # 安装依赖（务必用 ci，lockfile 是构建的一部分）
npm run lint          # 941 条静态断言（契约/DDL/迁移/Token/图标/CSS 变量/脱敏）
npm run typecheck     # 前后端类型检查 + 13 条编译期负向断言
npm run build         # 前端真实构建
npm run verify:db     # 数据库真实执行验证（需 PG18；无 PG 时 exit 2 并指向手工清单）
npm run recall:pitfalls   # 按技术栈指纹召回本项目已知坑
npm run lint:publish      # 公开仓脱敏门禁
```

## 提交前必须全绿

```bash
npm run lint && npm run typecheck && npm run build
```

任一红则**不要提交**。CI 会重复执行同样的检查。

## 硬约束（违反即退回）

这些不是风格偏好，是本项目存在的理由：

### 1. 合规边界必须落在类型与断言上，不是文档里

「AI 不得出诊断结论」这条不是靠 code review 保证的，是靠：

```yaml
SegmentationStructure:
  additionalProperties: false
  required: [structureName, structureLabelZh, volumeMl, confirmed]
```

加上 `verify-types.ts` 里的 13 条 `@ts-expect-error` 负向断言。
**任何人往契约里加 `nature` / `malignancy` 字段，`tsc` 会直接失败。**

同理，越权响应（10004）与「资源不存在」（10005）必须**不可区分**：
响应时间、状态码、响应体大小三者一致。这靠 `AppError.inaccessible()` 统一，
不要自己 `new AppError(10004, '患者不存在')` —— 消息带任何可区分信息都会泄露患者存在性。

### 2. 不要绕过设计 Token

颜色、间距、字号一律 `var(--color-*)`。`scripts/lint_css_vars.js` 会检查引用的变量是否存在
（CSS 变量不存在时浏览器**不报错**，只是静默回退，最难查）。

**阅片 Canvas 恒暗** —— 亮色主题下 `--color-surface-canvas` 仍是深色。
灰阶影像在白底上丧失诊断对比（AAPM TG-18）。不要"修正"它。

### 3. 不要引入第二套图标库

只用 `@tabler/icons-react`。**导出名带 `Icon` 前缀**（`IconAlertTriangle`），
库里没有不带前缀的别名。图标名必须真实存在 —— `scripts/lint_icons.js` 会校验。

### 4. 开放源码许可的合规约束

- TotalSegmentator 的 46 个 task 中**仅 31 个是 Apache-2.0**，
  `brain_aneurysm` 是 CC BY-NC 4.0（**不可商用**）。
  AI 服务启动时必须强校验 task 白名单，非白名单拒绝并审计（40003）。
- Redis 8.x 采用 AGPLv3。闭源交付场景建议改用 Valkey（BSD）。

详见 `docs/licenses/THIRD-PARTY.md`。

### 5. 审计不可绕过

审计钩子挂在 `onRequest` 而非业务层 —— 业务代码可能忘记调用，
而且**失败路径（越权被拒）同样必须审计**。审计写入失败必须 **fail-closed**（拒绝请求），
不得静默放行。

## 遇到报错时

先跑：

```bash
npm run recall:pitfalls
```

它按**技术栈指纹**（不是需求文字）召回本项目已知的坑。
匹配到你的技术栈时，它会给出根因与修法。**多数 Cornerstone / PostgreSQL / DICOM 的坑都在里面。**

新踩的坑请追加到 `.workbuddy/memory/pitfalls.jsonl`：

```json
{"signature":"<稳定签名，剥离版本号行号>","family":"dependency|runtime|type|build|test|security|database|tooling","first_seen":"...","last_seen":"...","episode_count":1,"stack_fingerprint":["pkg@ver"],"root_cause":"...","fix":"...","validated":false}
```

签名必须稳定（剥离路径、行号、版本号），这样同一类错误才会累积到同一条而不是刷屏。

## 代码组织

| 规则 | 说明 |
|------|------|
| 单文件 ≤300 行 | |
| 单一职责 | |
| 入口只装配，零业务逻辑 | |
| 依赖只向下 | controllers → services → repositories |
| SQL 只在 repositories | service 不碰 SQL |
| 参数化查询 | PHI 既是隐私数据也是注入面 |

## 提交信息

用中文，描述「做了什么」与「为什么」，不只说「改了文件」。
