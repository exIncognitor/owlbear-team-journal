# Cloudflare Pages 部署

## 当前发布 · 团队手记 v0.2.0 · 2026-11-05

- 原项目 `owlbear-twisted-moon` 免费 Direct Upload 更新完成，Cloudflare 显示 Success，11/11 文件上传成功；没有新建图片站，没有修改战斗插件。
- 安装链接保持 https://owlbear-twisted-moon.pages.dev/manifest.json 。浏览器实际打开清单，确认 name/title 为“团队手记”、version 为 0.2.0、书本图标版本参数、760 × 700 原生 Action 入口。
- 浏览器实际加载生产 `/panel`，确认紧凑顶栏、共享容量、4 个分区与“欢迎来到德鲁斯肯瓦尔德”长条成就，左侧简笔画、主要内容为文字。生产独立演示不等于真实房间验收。
- 源码提交：b13ccdf7c7377c3369ae31b1b6d16aaea484bb9f；任务前 Git 恢复点：b3b78272bdeebc76783b560c8b7b83b1d5d1c6f0。
- 发布包：`DEPLOY-READY-v0.2.0.zip`，只包含 dist 的 11 个文件；SHA-256 为 `11bf51e664acb1f99757d92c8589baec2d965f2d5598375935c5c20733cc1f0a`。
- 凭证：`qa/deploy-success-v0.2.0.png`、`qa/production-achievements-v0.2.0.png`、`qa/production-verification-v0.2.0.json`。截图、ZIP 和验证 JSON 不上传源码或站点。
- 本次命令行请求清单、图标和面板均返回 HTTP 403 / Cloudflare error 1010，浏览器访问正常。因此本次未完成逐文件线上哈希、实际 HTTP 响应头和带 obrref 的跳转保留检查；不沿用 v0.1.0 的结果冒充当前验证。
- 公开房间数据键保持不变；DM 私密插画按用户选择只保存在当前浏览器。默认欢迎成就是代码内置记录，不自动向正式房间写测试资料。
- 私有图片仓库 `exIncognitor/dnd-github-images` 已创建，当前无图片；用户最终选择不部署对应 Cloudflare 图片站。私有 GitHub Raw 地址不是玩家免登录图床。

## 历史发布 · v0.1.0

本项目为独立纯静态插件。与旧的 owlbear-combat-panel 仓库和站点分开，不修改旧插件。

- 新仓库名称：exIncognitor/owlbear-twisted-moon（公开）。
- Pages 项目名称：owlbear-twisted-moon。
- 产品主页：https://owlbear-twisted-moon.pages.dev/
- 安装地址：https://owlbear-twisted-moon.pages.dev/manifest.json
- 原生 Action 入口：/panel.html，760 × 700，黑色背景。

已于 2026-11-05 在独立的免费 Direct Upload 项目发布 v0.1.0。Cloudflare 返回 Success，生产 9 个可访问静态文件的 SHA-256 与本地构建逐项一致；第 10 个文件 _headers 由实际响应头验证。manifest 为 JSON、CORS 为 *、no-cache、CSP 允许 Owlbear、没有 X-Frame-Options，/panel.html 规范化至 /panel 并保留 obrref。浏览器已实际打开生产面板，显示本地演示与正确的三个分区。

- 产品源码提交与首次恢复点：57e2de6889fcda4753ad6a2e2cf85b09c619875b。
- 部署包：项目根目录 DEPLOY-READY-v0.1.0.zip，仅 dist 根目录 10 个文件。
- ZIP SHA-256：3e8fe2ee45684395bace190b67ba0d0021487acff2c8008b3e1627cea6fb4950。
- 本地发布页面凭证：qa/deploy-success.png。此截图与其他 QA 文件不上传仓库或部署。

没有上传源码、node_modules、qa、history、备份、图片原件或凭据。没有 Git 自动部署，推送 GitHub 后仍须单独发布构建；后续纯文档提交不改变此次线上构建。

## 构建与更新

1. npm ci、npm test、npm run build、npm run test:e2e。
2. 检查 dist 内容与 manifest 版本，将 dist 内容打包到版本 ZIP。
3. 在该 Pages 项目创建 Production 部署，上传 ZIP 并发布。
4. 对 dist 中除 _headers 外的静态文件逐项比较线上 SHA-256。
5. 验证 manifest JSON、书本图标、CORS、no-cache、frame-ancestors 允许 Owlbear、无 X-Frame-Options，确认 /panel.html 规范化跳转保留 obrref；受阻时如实记录未完成项。
6. 用户添加 manifest 到房间；后续更新刷新整个房间，无需更换安装链接。

真实平台验收由用户进行：原生图标开关、宽面板尺寸、双方编辑和同步、图库直接选择、DM 私密/公开切换、成就仅 DM 编辑/全员可见、插画展示、切换场景与重连。自动化模拟不等同于真实房间测试。
