import { expect, test } from "@playwright/test";

// Actual SDK + two local host frames. This does not contact or mutate a room.
test("native SDK shares warehouse, notes, direct gallery selection and room usage between both clients", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1580, height: 790 });
  let fileChoosers = 0;
  page.on("filechooser", () => fileChoosers++);
  const pixel = await page.screenshot({
    clip: { x: 0, y: 0, width: 40, height: 40 },
  });
  await page.route("https://images.example.org/landscape.png", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
  const privateRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url() === "https://images.example.org/private.png")
      privateRequests.push(request.frame().name());
  });
  await page.route("https://images.example.org/private.png", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
  const origin = "http://127.0.0.1:5183";
  const ref = encodeURIComponent(
    Buffer.from(`${origin} local-team-room`).toString("base64"),
  );
  const otherRef = encodeURIComponent(
    Buffer.from(`${origin} another-team-room`).toString("base64"),
  );
  await page.route("**/native-test", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><meta charset="utf-8"><style>body{margin:0;background:#292b39;color:white;font:14px sans-serif}.client{display:inline-block;width:760px;vertical-align:top;margin:12px}iframe{display:block;width:760px;height:700px;border:0}.label{height:25px}</style><div class="client"><div class="label">模拟玩家客户端</div><iframe id="player" name="player" title="玩家客户端" src="/panel.html?obrref=${ref}"></iframe></div><div class="client"><div class="label">模拟 DM 客户端</div><iframe id="dm" name="dm" title="DM 客户端" src="/panel.html?obrref=${ref}"></iframe></div><output id="events" hidden></output><output id="metadata" hidden></output><script>
    const frames=[...document.querySelectorAll('iframe')];
    let metadata=JSON.parse(localStorage.getItem('native-test-metadata')||'{"other.extension":{"untouched":true}}');
    let otherMetadata=JSON.parse(localStorage.getItem('native-test-other-metadata')||'{}');
    const otherFrame=document.createElement('iframe');otherFrame.id='other';otherFrame.name='other';otherFrame.title='另一个房间';otherFrame.src='/panel.html?obrref=${otherRef}';document.body.append(otherFrame);frames.push(otherFrame);
    const events=[];let galleryCalls=0;
    for(const frame of frames)frame.onload=()=>frame.contentWindow.postMessage({id:'OBR_READY',data:{ref:frame.id,userId:frame.id}},location.origin);
    window.addEventListener('message',event=>{
      const frame=frames.find(f=>f.contentWindow===event.source);
      if(!frame||event.origin!==location.origin)return;
      const {id,data,nonce}=event.data;events.push({id,from:frame.id,options:id==='OBR_ASSETS_DOWNLOAD_IMAGES'?data:undefined,file:id==='OBR_ASSETS_UPLOAD_IMAGES'?data.images[0].file.name:undefined});document.getElementById('events').textContent=JSON.stringify(events);
      let response;
      if(id==='OBR_ACTION_SET_WIDTH')response={};
      if(id==='OBR_ACTION_SET_HEIGHT')response={};
      if(id==='OBR_ACTION_SET_TITLE'||id==='OBR_ACTION_SET_ICON')response={};
      if(id==='OBR_PLAYER_GET_ROLE')response={role:frame.id==='dm'?'GM':'PLAYER'};
      if(id==='OBR_ROOM_GET_METADATA')response={metadata:frame.id==='other'?otherMetadata:metadata};
      if(id==='OBR_ROOM_SET_METADATA'){
        let updated;
        if(frame.id==='other'){otherMetadata={...otherMetadata,...data.update};localStorage.setItem('native-test-other-metadata',JSON.stringify(otherMetadata));updated=otherMetadata;}
        else{metadata={...metadata,...data.update};localStorage.setItem('native-test-metadata',JSON.stringify(metadata));document.getElementById('metadata').textContent=JSON.stringify(metadata);updated=metadata;}response={};
        frames.filter(f=>(f.id==='other')===(frame.id==='other')).forEach(f=>f.contentWindow.postMessage({id:'OBR_ROOM_METADATA_EVENT_CHANGE',data:{metadata:updated}},location.origin));
      }
      if(id==='OBR_ASSETS_UPLOAD_IMAGES')response={};
      if(id==='OBR_ASSETS_DOWNLOAD_IMAGES'){
        galleryCalls++;
        if(data.multiple!==false||data.defaultSearch!==''||data.typeHint!=='CHARACTER'){
          event.source.postMessage({id:id+'_ERROR'+nonce,data:{issues:[{path:['typeHint'],message:'图片选择参数不完整'}]}},event.origin);return;
        }
        if(galleryCalls===1){event.source.postMessage({id:id+'_ERROR'+nonce,data:{message:'测试图库启动失败'}},event.origin);return;}
        response={images:galleryCalls===2?[]:[{name:'月下风景',image:{url:'https://images.example.org/landscape.png',width:40,height:40,mime:'image/png'}}]};
      }
      if(response!==undefined&&nonce)event.source.postMessage({id:id+'_RESPONSE'+nonce,data:response},event.origin);
    });
  </script></html>`,
    }),
  );
  await page.goto("/native-test");
  const player = page.frameLocator("#player"),
    dm = page.frameLocator("#dm"),
    other = page.frameLocator("#other");
  await expect(
    player.getByText("已连接房间资料", { exact: true }),
  ).toBeVisible();
  await expect(player.getByText("本地演示", { exact: true })).toHaveCount(0);
  await expect(player.locator("body")).toHaveCSS(
    "background-color",
    "rgb(11, 12, 17)",
  );
  await player.getByRole("button", { name: "添加物品" }).click();
  await player.getByLabel("名称", { exact: true }).fill("玩家添加的装备");
  await player.getByLabel("分类", { exact: true }).selectOption("装备");
  await player.getByLabel("数量", { exact: true }).fill("3");
  await player.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    dm.getByRole("heading", { name: "玩家添加的装备", exact: true }),
  ).toBeVisible();
  await dm
    .getByRole("button", { name: "编辑玩家添加的装备", exact: true })
    .click();
  await dm.getByLabel("保管人", { exact: true }).fill("全队");
  await dm.getByRole("button", { name: "保存", exact: true }).click();
  await expect(player.getByText("保管：全队", { exact: true })).toBeVisible();
  await dm.getByRole("button", { name: "调整金钱", exact: true }).click();
  await dm.getByLabel("金币 · GP", { exact: true }).fill("500");
  await dm.getByRole("button", { name: "保存金钱", exact: true }).click();
  await expect(player.getByLabel("金币余额", { exact: true })).toHaveText(
    "500",
  );
  for (const frame of [player, dm])
    await frame.getByRole("button", { name: /^情报/ }).click();
  await player.getByRole("button", { name: "记录情报" }).click();
  await player.getByLabel("标题", { exact: true }).fill("共有线索");
  await player
    .getByLabel("情报正文", { exact: true })
    .fill("玩家与 DM 共同维护的房间资料。\n".repeat(40));
  await player.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    dm.getByRole("heading", { name: "共有线索", exact: true }),
  ).toBeVisible();
  for (const frame of [player, dm])
    await frame.getByRole("button", { name: /^插画/ }).click();
  await player.getByRole("button", { name: "从图库选择", exact: true }).click();
  await expect(player.getByRole("alert")).toContainText(
    "无法打开 Owlbear 图库：测试图库启动失败",
  );
  await expect(player.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "qa/v0.3.2/gallery-error.png" });
  await player.getByRole("button", { name: "从图库选择", exact: true }).click();
  await expect(
    player.getByRole("button", { name: "从图库选择", exact: true }),
  ).toBeEnabled();
  await expect(player.getByRole("alert")).toHaveCount(0);
  await expect(player.getByRole("dialog")).toHaveCount(0);
  await expect(player.locator(".art-card")).toHaveCount(0);
  await player.getByRole("button", { name: "从图库选择", exact: true }).click();
  await expect(player.getByRole("dialog", { name: "添加资料" })).toBeVisible();
  await player.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    dm.getByRole("heading", { name: "月下风景", exact: true }),
  ).toBeVisible();
  await dm.getByRole("button", { name: "展示给全队", exact: true }).click();
  await expect(player.getByRole("region", { name: "当前展示" })).toContainText(
    "月下风景",
  );
  for (const frame of [player, dm]) {
    await frame.locator(".content").evaluate((e) => {
      e.scrollTop = 0;
    });
    await expect(
      frame.getByRole("region", { name: "当前展示" }).locator("img"),
    ).toHaveJSProperty("complete", true);
  }
  await page.screenshot({ path: "qa/v0.3.2/native-two-clients.png" });
  const metadata = JSON.parse(
    (await page.locator("#metadata").textContent()) || "{}",
  );
  expect(metadata["other.extension"]).toEqual({ untouched: true });
  expect(JSON.stringify(metadata)).not.toContain("data:image/");
  const events = JSON.parse(
    (await page.locator("#events").textContent()) || "[]",
  );
  expect(events.some((e: any) => e.id === "OBR_ASSETS_UPLOAD_IMAGES")).toBe(
    false,
  );
  expect(events.some((e: any) => e.id === "OBR_ASSETS_DOWNLOAD_IMAGES")).toBe(
    true,
  );
  expect(events.some((e: any) => e.id === "OBR_ACTION_SET_TITLE")).toBe(true);
  expect(fileChoosers).toBe(0);
  const bytes = new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
  for (const frame of [player, dm]) {
    await expect(frame.getByLabel("共享数据占用")).toHaveText(
      `房间共享 ${(bytes / 1000).toFixed(2)} / 16 kB`,
    );
    await expect(frame.getByLabel("共享数据占用")).toHaveAttribute(
      "title",
      new RegExp(`${bytes.toLocaleString()} B`),
    );
  }
  expect(
    events.some(
      (e: any) =>
        e.id.startsWith("OBR_POPOVER") || e.id.startsWith("OBR_SCENE"),
    ),
  ).toBe(false);
  await page.reload();
  await dm.getByRole("button", { name: /^插画/ }).click();
  await expect(dm.getByRole("region", { name: "当前展示" })).toContainText(
    "月下风景",
  );
  await expect(player.getByLabel("插画可见性")).toHaveCount(0);
  await expect(player.getByRole("button", { name: /^设为/ })).toHaveCount(0);
  await dm.getByRole("button", { name: "从链接导入", exact: true }).click();
  await expect(dm.getByLabel("插画可见性", { exact: true })).toHaveValue("gm");
  await dm.getByLabel("标题", { exact: true }).fill("DM 未公开插画");
  await dm
    .getByLabel("图片地址", { exact: true })
    .fill("https://images.example.org/private.png");
  await dm.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    dm.getByRole("heading", { name: "DM 未公开插画", exact: true }),
  ).toBeVisible();
  await expect(player.getByText("DM 未公开插画", { exact: true })).toHaveCount(
    0,
  );
  expect((await page.locator("#metadata").textContent()) || "{}").not.toContain(
    "private.png",
  );
  expect(privateRequests).not.toContain("player");
  // A full reload uses real browser localStorage, scoped to the DM account.
  await page.reload();
  for (const frame of [player, dm])
    await frame.getByRole("button", { name: /^插画/ }).click();
  await expect(
    dm.getByRole("heading", { name: "DM 未公开插画", exact: true }),
  ).toBeVisible();
  await expect(player.getByText("DM 未公开插画", { exact: true })).toHaveCount(
    0,
  );
  await dm
    .getByRole("button", { name: "设为玩家可见：DM 未公开插画", exact: true })
    .click();
  await expect(
    player.getByRole("heading", { name: "DM 未公开插画", exact: true }),
  ).toBeVisible();
  await player
    .getByRole("button", { name: "查看大图：DM 未公开插画", exact: true })
    .click();
  await expect.poll(() => privateRequests.includes("player")).toBe(true);
  await expect(
    player.getByRole("dialog", { name: "插画：DM 未公开插画", exact: true }),
  ).toBeVisible();
  await dm
    .getByRole("button", { name: "设为仅 DM 可见：DM 未公开插画", exact: true })
    .click();
  await expect(player.getByRole("dialog")).toHaveCount(0);
  await expect(player.getByText("DM 未公开插画", { exact: true })).toHaveCount(
    0,
  );
  expect((await page.locator("#metadata").textContent()) || "{}").not.toContain(
    "private.png",
  );
  await page.screenshot({ path: "qa/v0.3.2/private-gallery.png" });
  for (const frame of [player, dm])
    await frame.getByRole("button", { name: /^成就/ }).click();
  await other.getByRole("button", { name: /^成就/ }).click();
  for (const frame of [player, dm, other])
    await expect(frame.locator(".achievement-card")).toHaveCount(0);
  await dm.getByRole("button", { name: "添加成就" }).click();
  await dm.getByLabel("成就名", { exact: true }).fill("欢迎来到德鲁斯肯瓦尔德");
  await dm.getByLabel("描述", { exact: true }).fill("来到德鲁斯肯瓦尔德");
  await dm
    .getByLabel("配图链接", { exact: true })
    .fill("https://images.example.org/landscape.png");
  await dm.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    player.getByRole("heading", {
      name: "欢迎来到德鲁斯肯瓦尔德",
      exact: true,
    }),
  ).toBeVisible();
  await expect(player.getByRole("button", { name: "添加成就" })).toHaveCount(0);
  await expect(
    player.getByRole("button", {
      name: "编辑欢迎来到德鲁斯肯瓦尔德",
      exact: true,
    }),
  ).toHaveCount(0);
  await dm
    .getByRole("button", { name: "编辑欢迎来到德鲁斯肯瓦尔德", exact: true })
    .click();
  await dm.getByLabel("描述", { exact: true }).fill("我们的冒险从这里开始。");
  await dm.getByLabel("品质", { exact: true }).selectOption("优秀");
  await dm.getByRole("button", { name: "保存", exact: true }).click();
  await expect(player.locator(".achievement-card")).toContainText(
    "我们的冒险从这里开始。",
  );
  await expect(player.locator(".achievement-card")).toContainText("优秀");
  await dm.getByRole("button", { name: "添加成就" }).click();
  await dm.getByLabel("成就名", { exact: true }).fill("下一段旅程");
  await dm.getByLabel("描述", { exact: true }).fill("继续探索未知。");
  await dm
    .getByLabel("配图链接", { exact: true })
    .fill("https://images.example.org/landscape.png");
  await expect(dm.locator('input[type="file"]')).toHaveCount(0);
  await dm.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    player.getByRole("heading", { name: "下一段旅程", exact: true }),
  ).toBeVisible();
  await expect(other.locator(".achievement-card")).toHaveCount(0);
  await page.reload();
  await player.getByRole("button", { name: /^成就/ }).click();
  await expect(
    player.getByRole("heading", { name: "下一段旅程", exact: true }),
  ).toBeVisible();
  await other.getByRole("button", { name: /^成就/ }).click();
  await expect(other.locator(".achievement-card")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("native-test-other-metadata"),
    ),
  ).toBeNull();
});
