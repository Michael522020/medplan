import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// 设计 Token 唯一来源。改 Token 只改 docs/design-tokens.json 并重跑
// scripts/build_tokens.py，禁止手改 CSS。
import '@medplan/design-tokens/tokens.css';
import './styles/global.css';
import './styles/app.css';

import { App } from './App';
import { installMockServer } from './mocks/install';

const container = document.getElementById('root');
if (!container) {
  throw new Error('缺少 #root 挂载点');
}

/**
 * 开发期 Mock。
 *
 * 通过 `VITE_USE_MOCK` 显式开启，默认关闭 —— 生产构建绝不能带上 Mock，
 * 否则会把演示数据当成真实数据展示给医生。
 */
const useMock = import.meta.env.VITE_USE_MOCK === 'true';
installMockServer(useMock);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
