import { expect, test } from "@playwright/test";

test("money, items and equipment can be edited and survive a reload", async ({
  page,
}) => {
  await page.goto("/panel.html");
  await page.getByRole("button", { name: "调整金钱", exact: true }).click();
  await page.getByLabel("金币 · GP", { exact: true }).fill("220");
  await page.getByRole("button", { name: "保存金钱", exact: true }).click();
  await expect(page.getByLabel("金币余额", { exact: true })).toHaveText("220");
  await page.getByRole("button", { name: "添加物品" }).click();
  await page.getByLabel("名称", { exact: true }).fill("月银长弓");
  await page.getByLabel("分类", { exact: true }).selectOption("装备");
  await page.getByLabel("数量", { exact: true }).fill("2");
  await page.getByLabel("保管人", { exact: true }).fill("队伍公用");
  await page.getByLabel("物品说明", { exact: true }).fill("留给下一次远行。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "月银长弓", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("金币余额", { exact: true })).toHaveText("220");
  await page.getByLabel("筛选分类").selectOption("装备");
  await expect(
    page.getByRole("heading", { name: "治疗药水", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "编辑月银长弓", exact: true }).click();
  await page.getByLabel("数量", { exact: true }).fill("5");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page
      .locator("article")
      .filter({
        has: page.getByRole("heading", { name: "月银长弓", exact: true }),
      })
      .locator(".quantity strong"),
  ).toHaveText("5");
});

test("intelligence supports multiline notes, search, resolved status and cancelled removal", async ({
  page,
}) => {
  await page.goto("/panel.html");
  await page.getByRole("button", { name: /^情报/ }).click();
  await page.getByRole("button", { name: "记录情报" }).click();
  await page.getByLabel("标题", { exact: true }).fill("钟楼的信件");
  await page.getByLabel("分类", { exact: true }).selectOption("地点");
  await page
    .getByLabel("情报正文", { exact: true })
    .fill("第一段线索。\n第二段待办。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByLabel("搜索资料").fill("钟楼");
  await expect(
    page.getByText("第一段线索。\n第二段待办。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "标记已整理：钟楼的信件", exact: true })
    .click();
  await page.getByLabel("筛选分类").selectOption("已整理");
  await page
    .getByRole("button", { name: "编辑钟楼的信件", exact: true })
    .click();
  await page.getByRole("button", { name: "移除条目", exact: true }).click();
  await page.getByRole("button", { name: "保留条目", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "钟楼的信件", exact: true }),
  ).toBeVisible();
});

test("uploaded artwork persists locally, can be presented and viewed, and removal clears presentation", async ({
  page,
}) => {
  await page.goto("/panel.html");
  const image = await page.screenshot({
    clip: { x: 0, y: 0, width: 64, height: 64 },
  });
  await page.getByRole("button", { name: /^插画/ }).click();
  await page.getByLabel("上传插画文件").setInputFiles({
    name: "月下旅途.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.getByRole("dialog", { name: "添加资料" })).toBeVisible();
  await page.getByLabel("标题", { exact: true }).fill("月下旅途");
  await page.getByLabel("插画说明", { exact: true }).fill("我们的第一幅插画。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "展示给全队", exact: true }).click();
  await expect(page.getByRole("region", { name: "当前展示" })).toContainText(
    "月下旅途",
  );
  await page.reload();
  await page.getByRole("button", { name: /^插画/ }).click();
  await page
    .getByRole("region", { name: "当前展示" })
    .getByRole("button", { name: "查看大图：月下旅途", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "插画：月下旅途" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回插画", exact: true }).click();
  await page.getByRole("button", { name: "编辑月下旅途", exact: true }).click();
  await page.getByRole("button", { name: "移除条目", exact: true }).click();
  await page.getByRole("button", { name: "确认移除", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "尚未展示插画", exact: true }),
  ).toBeVisible();
});

test("two demo tabs share updates, and stale editors cannot overwrite a teammate", async ({
  page,
  context,
}) => {
  await page.goto("/panel.html");
  const other = await context.newPage();
  await other.goto("/panel.html");
  await page.getByRole("button", { name: "编辑治疗药水", exact: true }).click();
  await other
    .getByRole("button", { name: "编辑治疗药水", exact: true })
    .click();
  await other.getByLabel("数量", { exact: true }).fill("10");
  await other.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByLabel("数量", { exact: true }).fill("4");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "队友修改",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page
      .locator("article")
      .filter({
        has: page.getByRole("heading", { name: "治疗药水", exact: true }),
      })
      .locator(".quantity strong"),
  ).toHaveText("10");
});

for (const width of [390, 760])
  test(`black information panel at ${width}px fits all sections and editors`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/panel.html");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(11, 12, 17)",
    );
    for (const name of [/^团队仓库/, /^情报/, /^插画/]) {
      await page.getByRole("button", { name }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.getByRole("button", { name: /^情报/ }).click();
    await page.getByRole("button", { name: "记录情报" }).click();
    await page.getByLabel("标题", { exact: true }).fill("宽屏与窄屏表单");
    await page
      .getByLabel("情报正文", { exact: true })
      .fill("键盘和滚动均可编辑。");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: /^团队仓库/ }).click();
    await page.screenshot({ path: `qa/panel-${width}.png` });
  });

test("export preserves owned records and the moon manifest uses native action", async ({
  page,
}) => {
  await page.goto("/panel.html");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出备份", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("歪曲之月-团队备份");
  const manifest = await (await page.request.get("/manifest.json")).json();
  expect(manifest.action).toMatchObject({
    popover: "/panel.html",
    width: 760,
    height: 700,
  });
  expect((await page.request.get("/icon.svg")).status()).toBe(200);
});

for (const width of [390, 1440])
  test(`homepage installation link and layout at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.locator("#install-url")).toHaveText(
      "http://127.0.0.1:5183/manifest.json",
    );
    await page.locator("#preview").scrollIntoViewIfNeeded();
    await expect(
      page
        .frameLocator("iframe")
        .getByRole("heading", { name: "团队金钱", exact: true }),
    ).toBeVisible();
    await page.locator(".site-nav").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `qa/home-${width}.png`, fullPage: true });
  });
