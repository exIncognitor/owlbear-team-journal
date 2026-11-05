import { expect, test } from "@playwright/test";

// Actual SDK + two local host frames. This does not contact or mutate a room.
test("native SDK shares warehouse, notes, upload and presentation between both clients", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1580, height: 790 });
  const pixel = await page.screenshot({
    clip: { x: 0, y: 0, width: 40, height: 40 },
  });
  await page.route("https://images.example.org/landscape.png", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
  const origin = "http://127.0.0.1:5183";
  const ref = encodeURIComponent(
    Buffer.from(`${origin} local-team-room`).toString("base64"),
  );
  await page.route("**/native-test", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><meta charset="utf-8"><style>body{margin:0;background:#292b39;color:white;font:14px sans-serif}.client{display:inline-block;width:760px;vertical-align:top;margin:12px}iframe{display:block;width:760px;height:700px;border:0}.label{height:25px}</style><div class="client"><div class="label">模拟玩家客户端</div><iframe id="player" title="玩家客户端" src="/panel.html?obrref=${ref}"></iframe></div><div class="client"><div class="label">模拟 DM 客户端</div><iframe id="dm" title="DM 客户端" src="/panel.html?obrref=${ref}"></iframe></div><output id="events" hidden></output><output id="metadata" hidden></output><script>
    const frames=[...document.querySelectorAll('iframe')];
    let metadata=JSON.parse(localStorage.getItem('native-test-metadata')||'{"other.extension":{"untouched":true}}');
    const events=[];
    for(const frame of frames)frame.onload=()=>frame.contentWindow.postMessage({id:'OBR_READY',data:{ref:frame.id,userId:frame.id}},location.origin);
    window.addEventListener('message',event=>{
      const frame=frames.find(f=>f.contentWindow===event.source);
      if(!frame||event.origin!==location.origin)return;
      const {id,data,nonce}=event.data;events.push({id,from:frame.id,file:id==='OBR_ASSETS_UPLOAD_IMAGES'?data.images[0].file.name:undefined});document.getElementById('events').textContent=JSON.stringify(events);
      let response;
      if(id==='OBR_ACTION_SET_WIDTH')response={};
      if(id==='OBR_ACTION_SET_HEIGHT')response={};
      if(id==='OBR_ROOM_GET_METADATA')response={metadata};
      if(id==='OBR_ROOM_SET_METADATA'){
        metadata={...metadata,...data.update};localStorage.setItem('native-test-metadata',JSON.stringify(metadata));document.getElementById('metadata').textContent=JSON.stringify(metadata);response={};
        frames.forEach(f=>f.contentWindow.postMessage({id:'OBR_ROOM_METADATA_EVENT_CHANGE',data:{metadata}},location.origin));
      }
      if(id==='OBR_ASSETS_UPLOAD_IMAGES')response={};
      if(id==='OBR_ASSETS_DOWNLOAD_IMAGES')response={images:[{name:'月下风景',image:{url:'https://images.example.org/landscape.png',width:40,height:40,mime:'image/png'}}]};
      if(response!==undefined&&nonce)event.source.postMessage({id:id+'_RESPONSE'+nonce,data:response},event.origin);
    });
  </script></html>`,
    }),
  );
  await page.goto("/native-test");
  const player = page.frameLocator("#player"),
    dm = page.frameLocator("#dm");
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
  await player.getByLabel("上传插画文件").setInputFiles({
    name: "shared-moon.png",
    mimeType: "image/png",
    buffer: pixel,
  });
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
  await page.screenshot({ path: "qa/native-two-clients.png" });
  const metadata = JSON.parse(
    (await page.locator("#metadata").textContent()) || "{}",
  );
  expect(metadata["other.extension"]).toEqual({ untouched: true });
  expect(JSON.stringify(metadata)).not.toContain("data:image/");
  const events = JSON.parse(
    (await page.locator("#events").textContent()) || "[]",
  );
  expect(
    events.some(
      (e: any) =>
        e.id === "OBR_ASSETS_UPLOAD_IMAGES" && e.file === "shared-moon.png",
    ),
  ).toBe(true);
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
});
