import { expect, test } from "@playwright/test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
let mf: Miniflare, config: Record<string, unknown>;
test.beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const bundle = await build({
    entryPoints: ["server/worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    plugins: [
      {
        name: "test-key",
        setup(api) {
          api.onLoad({ filter: /admin-public\.json$/ }, () => ({
            contents: JSON.stringify(publicKey),
            loader: "json",
          }));
        },
      },
    ],
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-11-05",
      d1Databases: ["DB"],
    }),
  );
  config = {
    id: "test-connection",
    name: "测试云端",
    endpoint: (await mf.ready).origin + "/api",
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
});
test.afterAll(async () => {
  await mf?.dispose();
});

test("standalone demo reports cloud storage after connecting and browser storage after switching back", async ({
  page,
}) => {
  await page.goto("/panel.html");
  await expect(page.locator("footer")).toContainText("资料保存在当前浏览器");
  await page.getByRole("button", { name: "存储设置", exact: true }).click();
  await page.getByLabel("云端连接配置文件", { exact: true }).setInputFiles({
    name: "test-cloud.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(config)),
  });
  await expect(page.getByRole("status")).toContainText("连接已验证");
  await page.getByLabel("新资料库名称").fill("独立演示的测试资料库");
  await page.getByRole("button", { name: "新建资料库", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已创建空资料库");
  await expect(page.getByLabel("模组资料库")).not.toHaveValue("");
  await page
    .getByRole("button", { name: "切换并保留原资料", exact: true })
    .click();
  await expect(page.locator("footer")).toContainText("已连接云端资料");
  await expect(page.locator("footer")).not.toContainText(
    "资料保存在当前浏览器",
  );
  await page.getByRole("button", { name: "存储设置", exact: true }).click();
  await page.getByLabel("存储来源").selectOption("room");
  await page
    .getByRole("button", { name: "切换并保留原资料", exact: true })
    .click();
  await expect(page.locator("footer")).toContainText("资料保存在当前浏览器");
});
test("DM storage settings switch one room across two libraries and restore room data while players follow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1580, height: 940 });
  const privateRequests: string[] = [];
  await page.route(
    "https://images.example.org/*-private.svg",
    async (route) => {
      privateRequests.push(
        (await (
          await route.request().frame().frameElement()
        ).getAttribute("id")) ?? "",
      );
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#463c59"/></svg>',
      });
    },
  );
  const origin = "http://127.0.0.1:5183";
  const src = (room: string) =>
    "/panel.html?obrref=" +
    encodeURIComponent(Buffer.from(`${origin} ${room}`).toString("base64"));
  const seed = (title: string) => ({
    "other.extension": { keep: true },
    "io.twisted-moon.v1/entry/local-item": {
      id: "local-item",
      rev: "seed",
      updatedAt: 1,
      kind: "item",
      title,
      category: "道具",
      quantity: 1,
      holder: "",
      description: "",
    },
  });
  await page.route("**/storage-test", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><meta charset="utf-8"><style>body{margin:0;background:#272936;font:14px sans-serif;color:white}iframe{width:760px;height:700px;border:0}.client{display:inline-block;width:760px;margin:12px;vertical-align:top}#other{height:150px}</style><div class="client">当前房间 DM<iframe id="dm" data-room="one" src="${src("one")}"></iframe></div><div class="client">当前房间玩家<iframe id="player" data-room="one" src="${src("one")}"></iframe></div><iframe id="other" data-room="two" src="${src("two")}"></iframe><output id="rooms" hidden></output><script>
    const frames=[...document.querySelectorAll('iframe')];const rooms={one:${JSON.stringify(seed("短团药水"))},two:${JSON.stringify(seed("另一个房间的资料"))}};
    function output(){document.getElementById('rooms').textContent=JSON.stringify(rooms)}output();
    frames.forEach(frame=>frame.onload=()=>frame.contentWindow.postMessage({id:'OBR_READY',data:{ref:frame.id,userId:frame.id==='player'?'player':'dm'}},location.origin));
    addEventListener('message',event=>{const frame=frames.find(frame=>frame.contentWindow===event.source);if(!frame||event.origin!==location.origin)return;const{id,data,nonce}=event.data;let response;
    if(id.startsWith('OBR_ACTION_SET_'))response={};
    if(id==='OBR_PLAYER_GET_ROLE')response={role:frame.id==='player'?'PLAYER':'GM'};
    if(id==='OBR_ROOM_GET_METADATA')response={metadata:rooms[frame.dataset.room]};
    if(id==='OBR_ROOM_SET_METADATA'){rooms[frame.dataset.room]={...rooms[frame.dataset.room],...data.update};output();response={};frames.filter(f=>f.dataset.room===frame.dataset.room).forEach(f=>f.contentWindow.postMessage({id:'OBR_ROOM_METADATA_EVENT_CHANGE',data:{metadata:rooms[frame.dataset.room]}},location.origin));}
    if(response!==undefined&&nonce)event.source.postMessage({id:id+'_RESPONSE'+nonce,data:response},event.origin);
    });</script></html>`,
    }),
  );
  await page.goto("/storage-test");
  const dm = page.frameLocator("#dm"),
    player = page.frameLocator("#player"),
    other = page.frameLocator("#other");
  async function addHidden(title: string, url: string) {
    await dm.getByRole("button", { name: /^插画/ }).click();
    await dm.getByRole("button", { name: "从链接导入", exact: true }).click();
    await dm.getByLabel("标题", { exact: true }).fill(title);
    await dm.getByLabel("图片地址", { exact: true }).fill(url);
    await dm.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      dm.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await dm.getByRole("button", { name: /^团队仓库/ }).click();
  }
  await expect(
    dm.getByRole("heading", { name: "短团药水", exact: true }),
  ).toBeVisible();
  await addHidden("房间私密图", "https://images.example.org/room-private.svg");
  await expect(
    player.getByRole("button", { name: "存储设置", exact: true }),
  ).toHaveCount(0);
  await dm.getByRole("button", { name: "存储设置", exact: true }).click();
  await dm.getByLabel("云端连接配置文件", { exact: true }).setInputFiles({
    name: "test-cloud.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(config)),
  });
  await expect(dm.getByRole("status")).toContainText("连接已验证");
  const connectionId = await dm.getByLabel("存储来源").inputValue();
  await dm.getByLabel("新资料库名称").fill("长期团 A");
  await dm.getByRole("button", { name: "新建资料库", exact: true }).click();
  await expect(dm.getByRole("status")).toContainText("已创建空资料库");
  await expect(dm.getByLabel("模组资料库")).not.toHaveValue("");
  const libA = await dm.getByLabel("模组资料库").inputValue();
  await dm
    .getByRole("button", { name: "复制当前资料到所选目标", exact: true })
    .click();
  await dm.getByRole("button", { name: "确认复制", exact: true }).click();
  await expect(dm.getByRole("status")).toContainText("复制完成");
  await dm
    .getByRole("button", { name: "切换并保留原资料", exact: true })
    .click();
  await expect(dm.getByLabel("共享数据占用")).toContainText("云端 · 长期团 A");
  await expect(player.getByLabel("共享数据占用")).toContainText(
    "云端 · 长期团 A",
  );
  await expect(other.getByLabel("共享数据占用")).toContainText("房间共享");
  await expect(
    other.getByRole("heading", { name: "另一个房间的资料", exact: true }),
  ).toBeVisible();
  await player
    .getByRole("button", { name: "编辑短团药水", exact: true })
    .click();
  await player.getByLabel("名称", { exact: true }).fill("云端 A 药水");
  await player.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    dm.getByRole("heading", { name: "云端 A 药水", exact: true }),
  ).toBeVisible();
  await addHidden("云端私密图", "https://images.example.org/cloud-private.svg");
  await player.getByRole("button", { name: /^插画/ }).click();
  await expect(player.getByText("云端私密图", { exact: true })).toHaveCount(0);
  await player.getByRole("button", { name: /^团队仓库/ }).click();
  await dm.getByRole("button", { name: "存储设置", exact: true }).click();
  await dm.getByLabel("存储来源").selectOption(connectionId);
  await dm.getByLabel("新资料库名称").fill("短模组 B");
  await dm.getByRole("button", { name: "新建资料库", exact: true }).click();
  await expect(dm.getByRole("status")).toContainText("已创建空资料库");
  await expect(dm.getByLabel("模组资料库")).not.toHaveValue(libA);
  await dm
    .getByRole("button", { name: "切换并保留原资料", exact: true })
    .click();
  await expect(player.getByLabel("共享数据占用")).toContainText("短模组 B");
  await expect(
    player.getByRole("heading", { name: "云端 A 药水", exact: true }),
  ).toHaveCount(0);
  await dm.getByRole("button", { name: "存储设置", exact: true }).click();
  await dm.getByLabel("存储来源").selectOption(connectionId);
  await dm.getByLabel("模组资料库").selectOption(libA);
  await dm
    .getByRole("button", { name: "切换并保留原资料", exact: true })
    .click();
  await expect(
    player.getByRole("heading", { name: "云端 A 药水", exact: true }),
  ).toBeVisible();
  await dm.getByRole("button", { name: "存储设置", exact: true }).click();
  await dm.getByLabel("存储来源").selectOption("room");
  await page.screenshot({ path: "qa/v0.3.2/storage-settings.png" });
  await dm
    .getByRole("button", { name: "切换并保留原资料", exact: true })
    .click();
  await expect(
    player.getByRole("heading", { name: "短团药水", exact: true }),
  ).toBeVisible();
  const rooms = await page.locator("#rooms").textContent();
  expect(rooms).not.toContain((config.privateKey as JsonWebKey).d);
  expect(rooms).toContain("另一个房间的资料");
  expect(rooms).not.toContain("cloud-private.svg");
  expect(rooms).not.toContain("room-private.svg");
  await dm.getByRole("button", { name: /^插画/ }).click();
  await expect(
    dm.getByRole("heading", { name: "房间私密图", exact: true }),
  ).toBeVisible();
  await expect(dm.getByText(/枭雄房间模式下/)).toBeVisible();
  await dm.getByRole("button", { name: "存储设置", exact: true }).click();
  await dm.getByLabel("存储来源").selectOption(connectionId);
  await dm.getByLabel("模组资料库").selectOption(libA);
  await dm
    .getByRole("button", { name: "切换并保留原资料", exact: true })
    .click();
  await expect(
    dm.getByRole("heading", { name: "云端私密图", exact: true }),
  ).toBeVisible();
  await expect(
    dm.getByText("仅 DM 可见 · 云端", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "qa/v0.3.2/cloud-private.png" });
  await page.evaluate(() => localStorage.clear());
  await page
    .locator("#dm")
    .evaluate((el: HTMLIFrameElement) => el.contentWindow!.location.reload());
  await dm.getByRole("button", { name: /^插画/ }).click();
  await expect(dm.getByText(/尚未导入 DM 管理配置/)).toBeVisible();
  await dm.getByRole("button", { name: "存储设置", exact: true }).click();
  await dm.getByLabel("云端连接配置文件", { exact: true }).setInputFiles({
    name: "test-cloud.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(config)),
  });
  await expect(dm.getByRole("status")).toContainText("连接已验证");
  await dm.getByRole("button", { name: "返回手记", exact: true }).click();
  await expect(
    dm.getByRole("heading", { name: "云端私密图", exact: true }),
  ).toBeVisible();
  expect(privateRequests).not.toContain("player");
});
