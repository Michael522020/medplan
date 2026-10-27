# 第三方依赖许可清单

> 用途：公开仓库必须说明各依赖的许可，避免「不知道能不能商用」的问题。
> 依据：`docs/decisions/ADR-009.md`（公开策略）、`ADR-001`（PACS 选型）、`ADR-003`（AI 引擎选型）

---

## 一、可闭源集成的依赖

这些许可允许在闭源商业产品中使用，适合院内私有化交付。

| 依赖 | 版本 | 许可 | 商用 | 说明 |
|------|------|------|------|------|
| React / React DOM | 19.3.1 | MIT | 允许 | — |
| NestJS | 12.2.0 | MIT | 允许 | — |
| Fastify | 5.12.7 | MIT | 允许 | — |
| PostgreSQL | 18 | PostgreSQL License | 允许 | 类 BSD，类 BSD 条款 |
| Redis | 8.10.2 | RSALv2 / SSPL（7.0+）/ 三方许可（8.x 起改用 AGPLv3） | **需逐版本确认** | Redis 8.x 许可有变，商用需确认条款或改用 Valkey |
| TypeScript | 5.9.3 | Apache-2.0 | 允许 | — |
| Vite | 8.3.5 | MIT | 允许 | — |
| **@cornerstonejs/core / tools / dicom-image-loader** | 5.13.2 | **MIT** | 允许 | 自研封装层的核心 |
| @cornerstonejs/streaming-image-volume-loader | 1.86.1 | MIT | 允许 | — |
| dcmjs | 0.52.2 | MIT | 允许 | — |
| dicomweb-client | 0.11.3 | MIT | 允许 | — |
| **@tabler/icons-react** | 3.49.0 | **MIT** | 允许 | 全项目唯一图标库 |
| pg (node-postgres) | 8.23.1 | MIT | 允许 | — |
| **ioredis** | **6.0.0** | **MIT** | **允许** | **Redis 客户端库（不含 Redis 服务端代码）。用于 AI 任务队列的 Redis Stream 投递与消费** |
| openapi-typescript | 7.4.4 | MIT | 允许 | — |

---

## 二、弱著佐权（可闭源，但改动的文件需开源）

| 依赖 | 版本 | 许可 | 商用 | 说明 |
|------|------|------|------|------|
| **dcm4chee-arc-light** | 5.35.2 | **MPL-2.0** | 允许 | 文件级弱著佐权：**修改该项目的文件需开源，但你的应用代码可以闭源**。这正是选它而非 Orthanc 的原因（ADR-001） |
| Keycloak | 26.8.1 | Apache-2.0 | 允许 | — |

---

## 三、⚠️ 需特别注意的许可

### TotalSegmentator

| 项 | 内容 |
|----|------|
| 主库许可 | Apache-2.0 |
| **模型权重许可** | **46 个 task 中仅 31 个是 Apache-2.0**；14 个需商业授权；**`brain_aneurysm` 是 CC BY-NC 4.0**（明确不给商业许可） |
| 我们的处理 | AI 服务**启动时强校验 task 白名单**，非白名单请求拒绝并审计（错误码 40003）。白名单常量每条附许可类型与来源注释 |
| 依据 | ADR-003 |

**CC BY-NC 4.0 是不允许商业使用的**。若院方商业部署需要 `brain_aneurysm`，必须单独采购授权或从白名单移除。

### Redis 8.x

Redis 在 7.0 之后改用 RSALv2 / SSPL / AGPLv3 三选一许可，8.x 起主推 AGPLv3。
**AGPLv3 对闭源 SaaS 有网络分发传染性**。若院方要求纯闭源交付，建议改用 **Valkey**（BSD 许可，Redis 社区 fork）。
本项目在文档中把 Redis 的用途限定为「缓存/会话/任务队列」，实际可替换。

**注意区分「客户端」与「服务端」**：

| 组件 | 许可 | 影响 |
|------|------|------|
| **ioredis 6.0.0**（本项目使用的客户端库） | **MIT** | 可闭源商用，无传染性 |
| Redis 8.x **服务端** | AGPLv3 等 | 需按上文确认或改用 Valkey |

客户端库与服务端是两回事 —— ioredis 只是通过 TCP 协议说话，
不包含任何 Redis 服务端代码，因此不受 AGPLv3 影响。

---

## 四、本项目自身的许可

`package.json` 中的 `license` 字段与根目录 `LICENSE` 文件需一致。

- 私有交付仓（`medplan`）：保持 `UNLICENSED`（保留所有权利），因为它包含院方定制内容与商业信息
- 公开方法论仓（`medplan-compliance-patterns`）：建议 **Apache-2.0**，与多数依赖兼容，且明确允许专利授权

---

## 五、字体许可

| 字体 | 许可 | 说明 |
|------|------|------|
| Inter | SIL OFL 1.1 | 可嵌入可商用 |
| Noto Sans SC | SIL OFL 1.1 | 可嵌入可商用 |
| JetBrains Mono | SIL OFL 1.1 | 可嵌入可商用 |

三者均为开源字体许可，**可以随应用一起分发**，无需额外授权。

---

## 六、核查方式

```bash
# 逐包查看
npm ls --all --json | node -e "..."   # 或直接看各包的 package.json 的 license 字段

# 自动门禁
node scripts/lint_publish.js           # 会校验本清单存在且含关键依赖与 NC 条款标注
```

**新增依赖时必须更新本清单**，否则 `lint_publish.js` 的断言会在下一次检查时提醒。
