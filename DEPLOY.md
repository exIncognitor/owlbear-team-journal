# Cloudflare Pages 部署

## 待发布 · v0.3.3 · 2026-11-06

- Chrome 真实房间已复现图库错误并取得宿主原因，修复空 `defaultSearch` 参数，同时包含空房间默认成就修复。
- 发布包 `DEPLOY-READY-v0.3.3.zip`，13 文件，SHA-256 为 `6f5ec7e0a4a551e7a191c093a33004e9acb97f2448abb5917c1c10c01ff83365`。47 项逻辑/D1、14 组浏览器回归与构建通过，管理私钥排除检查通过。
- Chrome 已打开原项目的登录页面，等待用户完成原 Cloudflare 账号登录。当前公开清单实测仍为 v0.3.1，v0.3.2 候选从未上传。
- 本次恢复起点为 `68974bdfb1eedc2d0064220e71480f7b33754e9e`。发布后继续使用原安装地址。

## 发布候选 · v0.3.2 · 2026-11-06

- 本地完成空房间默认成就修复与图库兼容调整，46 项逻辑/D1、14 组浏览器回归及完整构建通过；真实图库打开尚未确认，详情见 TEST-REPORT.md。
- 上传包：`DEPLOY-READY-v0.3.2.zip`，13 个文件，SHA-256 为 `9210b92fefa07c38948ab6316df5ea58578d37d2f73c6db97035c54097af7e48`。已检查私钥未进入构建，复用原后端公钥与 D1 绑定，无数据迁移或清库。
- 当前尚未上传 Cloudflare。浏览器连接读取现有标签连续超时；`wrangler whoami` 返回未登录。生产仍为下述 v0.3.1，不能把本地版本号视为线上已更新。
- 任务 Git 恢复点：`5c40683e9abb43b09c52f676fdd78274f7f11b1a`。上传成功后沿用原安装链接；发布前用户房间不会自动获得本地修正。

## 当前发布 · 团队手记 v0.3.1 · 2026-11-05

- 在原 Pages 项目 `owlbear-twisted-moon` 完成 Production Direct Upload，13/13 文件上传成功并显示 Success。安装地址仍为 https://owlbear-twisted-moon.pages.dev/manifest.json ，浏览器读取清单确认版本 0.3.1。
- 云端隐藏插画使用独立 D1 表 `journal_private_art` 与签名管理接口；共享模式保留原 DM 本机记录。复用现有 `DB` 绑定和管理公钥，新增表不清空原业务数据。
- 在生产独立演示中连接已有“歪曲之月”资料库，完成真实签名私密读取，确认云端保存说明与“已连接云端资料”页脚；之后恢复独立演示原本的本机来源。未进入正式 Owlbear 房间，未编辑现有公开或私密战役记录；私密写入、失败保留、权限及清除网站数据后恢复由真实本地 D1 集成和浏览器测试覆盖。
- 40 项逻辑/D1 测试、14 组完整浏览器回归及 TypeScript/Vite/Worker 构建通过。首次发布复核发现独立演示页脚旧提示，已修正并重新发布最终构建；不将中间发布包当作最终包。
- 产品实现提交 `14a0221`，最终界面修正提交 `29bea5a`，测试修正提交 `f156a5b`；任务恢复点 `47c95c00fe4d82937187d8ac91bbc1610a1e2f29`。
- 最终包 `DEPLOY-READY-v0.3.1.zip` 共 13 个文件，SHA-256 为 `237f2e443e1e6a7a31df00e61854e44f2cb2d0b7dc30f199f7083dc1d61f9aac`。已检查所有构建文件不含管理私钥，公钥与原管理配置匹配。截图与 ZIP 仅本地保留。
- 最终生产凭证：`qa/v0.3.1/deploy-success-final.png`、`qa/v0.3.1/production-private-storage-final.png`；本地双端私密场景为 `qa/v0.3.1/cloud-private.png`。本版本未逐项核对线上静态文件哈希和 HTTP 响应头，不沿用旧版本结果。
- 战斗插件按用户后续要求撤回新增的图库同步入口及版本改动，源码恢复为 `159381462a468ba8d79b840169426cadb7419bdb` 并重新构建通过，线上仍为 v0.5.3，本次没有发布战斗更新。

## 历史发布 · 团队手记 v0.3.0 · 2026-11-05

- 在原 Pages 项目 `owlbear-twisted-moon` 完成 Production Direct Upload；13/13 文件上传成功，Cloudflare 显示 Success。沿用原域名及安装地址 https://owlbear-twisted-moon.pages.dev/manifest.json 。
- 浏览器实际读取生产清单，确认 version 为 0.3.0、书本图标及 760 × 700 原生入口；实际打开 `/panel`，确认新增 DM 存储设置。
- 免费 D1 `team-journal`（ID `c92c3522-b469-479c-a8c6-47e0c73706b3`）已创建，生产绑定变量 `DB` 已保存并随本次部署生效。包内为已打包 `_worker.js`，`_routes.json` 仅让 `/api/*` 调用 Worker。
- 在生产独立演示的 DM 设置导入本机管理连接，真实签名验证及资料库列表读取成功，并创建空资料库“歪曲之月”。未复制演示资料，未进入或修改正式 Owlbear 房间；真实房间 DM 仍需首次导入自己的管理配置。
- 首次配置见 [CLOUD-STORAGE.md](CLOUD-STORAGE.md)：连接文件位于 `C:\Users\12137\AppData\Local\TeamJournal\connections\team-journal-cloud.json`，只在本机保存，不提交或部署。后端只含公钥；构建已核验不含管理私钥。
- 产品源码提交：`56f58b3`；任务前 Git 恢复点：`201a0ce8a0ae149cbecdcdd7c99d7c9d4aba6bec`。版本 ZIP `DEPLOY-READY-v0.3.0.zip` 共 13 个文件，SHA-256 为 `da3fb5f4a7d4e0ed418b96eb05b7894feb17e037a5337e5c1cc7cb8f96b01d97`。
- 本地 34 项逻辑/D1 集成测试、13 组浏览器回归及 TypeScript/Vite/Worker 构建通过。生产浏览器验证不等于真实房间联机验收。
- 凭证：`qa/d1-created-v0.3.0.png`、`qa/d1-binding-v0.3.0.png`、`qa/deploy-success-v0.3.0.png`、`qa/production-storage-v0.3.0.png`。截图与版本 ZIP 仅本地保留，不上传源码或作为站点资源。
- 本轮命令行访问 Pages 曾返回 HTTP 403 / Cloudflare 1010，浏览器正常。本次未完成逐文件线上哈希及实际 HTTP 响应头核对，不沿用旧版本检查作为当前结果。
- 当前房间的来源选择与其他房间隔离。切换保留原资料；复制仅写入空目标。新云端库当前没有业务资料，正式房间仍保持原来源。私有图片仓库及不部署图片站的决定保持不变。

## 历史发布 · 团队手记 v0.2.0 · 2026-11-05

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
