# Cloudflare Pages 部署

本项目为独立纯静态插件。与旧的 owlbear-combat-panel 仓库和站点分开，不修改旧插件。

- 新仓库名称：exIncognitor/owlbear-twisted-moon（公开）。
- Pages 项目名称：owlbear-twisted-moon。
- 产品主页：https://owlbear-twisted-moon.pages.dev/
- 安装地址：https://owlbear-twisted-moon.pages.dev/manifest.json
- 原生 Action 入口：/panel.html，760 × 700，黑色背景。

当前发布状态将在上传并逐项核对后记录。创建免费 Direct Upload 项目，上传 dist 根目录内容的版本 ZIP；不上传源码、node_modules、qa、history、备份、图片原件或凭据。没有 Git 自动部署，推送 GitHub 后仍须单独发布构建。

## 构建与更新

1. npm ci、npm test、npm run build、npm run test:e2e。
2. 检查 dist 内容与 manifest 版本，将 dist 内容打包到版本 ZIP。
3. 在该 Pages 项目创建 Production 部署，上传 ZIP 并发布。
4. 对 dist 中除 _headers 外的静态文件逐项比较线上 SHA-256。
5. 验证 manifest JSON、月亮图标、CORS、no-cache、frame-ancestors 允许 Owlbear、无 X-Frame-Options，确认 /panel.html 规范化跳转保留 obrref。
6. 用户添加 manifest 到房间；后续更新刷新整个房间，无需更换安装链接。

真实平台验收由用户进行：原生图标开关、宽面板实际尺寸、双方编辑和同步、图库上传选择、插画展示、切换场景与重连。自动化模拟不等同于真实房间测试。
