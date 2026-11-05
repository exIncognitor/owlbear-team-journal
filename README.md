# 团队手记

Owlbear Rodeo 资料插件：书本图标、760 × 700 原生黑底面板，玩家与 DM 均可编辑公开资料。沿用原来的站点与数据命名空间，更新不清空现有房间资料。

- 安装链接：https://owlbear-twisted-moon.pages.dev/manifest.json
- 产品主页：https://owlbear-twisted-moon.pages.dev/
- 独立演示：https://owlbear-twisted-moon.pages.dev/panel.html
- 源码：https://github.com/exIncognitor/owlbear-twisted-moon

## 功能

- 团队仓库：五类钱币分别记账；道具与装备的名称、数量、保管人、说明可编辑，支持搜索与分类。
- 情报：线索、人物、地点、其他分类；多行正文、跟进/已整理状态、搜索。
- 插画只有两种导入方式：“从图库选择”和“从链接导入”。图库按钮直接调用官方选择器，不打开本地文件框、不调用上传 API。图片原件需先存入 Owlbear 图库，或已有可公开访问的 HTTPS 图片直链。
- 插画支持标题、说明、大图与全队展示。DM 可以选择“玩家可见”或“仅 DM 可见”。玩家可编辑公开插画，不能设置私密可见性。
- 成就：左侧小配图、右侧文字的深色长条列表，所有人可见，仅 DM 可新增、编辑与移除；配图仅接受 HTTPS 链接。标题、达成人、描述和品质显示为内容，不显示字段标签。
- 内置“欢迎来到德鲁斯肯瓦尔德”：团队 / 来到德鲁斯肯瓦尔德 / 普通，配村落入口简笔画。默认卡片不写入房间；DM 修改后保存到独立成就键，删除后不会自动重建。
- 顶栏紧凑，显示整个房间共享数据占用，按 JSON UTF-8 测算，包含其他插件；悬停查看精确字节。演示状态明确标记“演示数据”。无大标题和导出备份按钮。
- 点击书本图标打开，再次点击关闭；不读取或修改地图 Token。

## DM 私密插画

- DM 新增插画默认“仅 DM 可见”；玩家新增默认公开；旧版已有插画保持公开。
- 隐藏插画的链接、标题和说明仅保存于 DM 当前浏览器 localStorage，按房间和账号隔离，不写入 room/player metadata。图片文件仍在来源图库或图片站。
- 不跨设备或浏览器同步，清除浏览器数据会丢失隐藏记录。请保留原图与来源链接；界面会标明这个边界。
- 公开后才将引用同步到房间；重新隐藏会移除共享引用，并结束这张图的全队展示。玩家已打开的大图会关闭。已经看过、下载或复制的图片无法撤回。
- 先保存本地副本再隐藏；公开成功后才清理本地副本。发生写入失败时保留可恢复副本，并显示错误，不把仍公开的记录标为私密。
- DM 降为玩家时立即隐藏本地私密记录、关闭相关视图，并重新核实编辑身份。
- 这是插件对真实角色的操作控制；公开 room metadata 本身没有服务端写入权限隔离。

“展示给全队”同步插画页中的当前展示，不强制弹出队友面板。私密插画必须先公开才能全队展示。

## 数据与容量

- 保留命名空间 `io.twisted-moon.v1/` 与演示键 `twisted-moon.demo.v1`；每条记录、每种钱币使用独立键，其他插件数据不改写。
- 成就使用 `io.twisted-moon.v1/achievement/` 独立键，DM 操作时使用实际 Owlbear 角色校验；其他分区的玩家编辑功能不变。
- 公开资料存在 room metadata，切换场景仍保留；大文本按条目 gzip 压缩并限制解压长度。房间只存图片引用，禁止图片二进制或 data URL。
- 房间 metadata 的 16 kB 总量由所有插件共享，本插件在 15,500 字节预算前拦截保存。DM 本地私密记录不计入这个容量。
- 编辑前重新读取并检查记录版本，阻止已知的陈旧编辑覆盖。完全同时写同一记录仍可能最后写入覆盖；没有服务端事务锁。
- 解析失败保留原始数据并暂停编辑；移除需要确认。内部原始备份方法保留用于维护，界面不提供导出按钮。
- 独立演示仅保存在当前浏览器，以 DM 身份演示；不代表真实房间验收。

## 私有图片仓库

用户选择只建私有 GitHub 仓库、不部署图片 Cloudflare 站点：

- 仓库：https://github.com/exIncognitor/dnd-github-images
- 本地：`D:\desktop\dnd\DndGithubImages`，图片放入 `images/`。
- 初始化时没有图片。私有仓库普通 Raw 链接不能作为玩家免登录图床；不要在房间中粘贴带 token 的链接或凭据。

## 开发与验证

Node >=22.12，沿用官方 SDK 与现有锁定依赖。

```sh
npm ci
npm test
npm run build
npm run test:e2e
npm run dev -- --host 127.0.0.1 --port 5183
```

部署记录见 DEPLOY.md，验证记录见 TEST-REPORT.md。真实房间测试按用户安排由用户进行。未修改战斗面板项目，未上传战役原稿、私有插画或凭据。

## 官方依据

- [原生 Action](https://docs.owlbear.rodeo/extensions/apis/action/)
- [房间 metadata](https://docs.owlbear.rodeo/extensions/apis/room/)
- [图库选择](https://docs.owlbear.rodeo/extensions/apis/assets/)
- [玩家角色与事件](https://docs.owlbear.rodeo/extensions/apis/player/)
- [共享 Metadata](https://docs.owlbear.rodeo/extensions/reference/metadata/)
