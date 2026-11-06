import { expect, test } from "@playwright/test";

test("quantity shortcuts, transaction history and recovery survive reload", async ({
  page,
}) => {
  await page.goto("/panel.html");
  const potion = page.locator(".item-row, .item-card").filter({
    has: page.getByRole("heading", { name: "治疗药水", exact: true }),
  });
  await page
    .getByRole("button", { name: "增加数量：治疗药水", exact: true })
    .click();
  await expect(potion.locator(".quantity strong")).toHaveText("4");
  await page.getByRole("button", { name: "记一笔收支", exact: true }).click();
  await page.getByLabel("收支类型").selectOption("-1");
  await page.getByLabel("金币", { exact: true }).fill("10");
  await page.getByLabel("收支原因").fill("购买口粮");
  await page.reload();
  await page.getByRole("button", { name: "继续金钱草稿", exact: true }).click();
  await expect(page.getByLabel("收支原因")).toHaveValue("购买口粮");
  await page.getByRole("button", { name: "确认收支", exact: true }).click();
  await expect(page.getByLabel("金币余额", { exact: true })).toHaveText("115");
  await page.getByRole("button", { name: "收支流水", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("购买口粮");
  await expect(page.getByRole("dialog")).toContainText("金币 -10");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "编辑治疗药水", exact: true }).click();
  await page.getByRole("button", { name: "移除条目", exact: true }).click();
  await page.getByRole("button", { name: "确认移除", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "治疗药水", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: /^最近删除/ }).click();
  await expect(page.getByRole("dialog")).toContainText("治疗药水");
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("暂无记录");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(potion.locator(".quantity strong")).toHaveText("4");
  await page.screenshot({ path: "qa/v0.4.0/warehouse.png" });
});

test("entry drafts recover without auto-saving; pinning and manual order persist", async ({
  page,
}) => {
  await page.goto("/panel.html");
  await page.getByRole("button", { name: "添加物品", exact: false }).click();
  await page.getByLabel("名称", { exact: true }).fill("远行干粮");
  await page.getByLabel("置顶", { exact: true }).check();
  await page.getByLabel("排序", { exact: true }).fill("2");
  await page
    .getByLabel("物品说明", { exact: true })
    .fill("还有半页说明没有写完");
  await page.reload();
  await expect(page.getByRole("heading", { name: /远行干粮/ })).toHaveCount(0);
  await page.getByRole("button", { name: "继续编辑草稿", exact: true }).click();
  await expect(page.getByLabel("物品说明", { exact: true })).toHaveValue(
    "还有半页说明没有写完",
  );
  await expect(page.getByLabel("置顶", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("article h3").first()).toContainText("远行干粮");
  await expect(
    page.getByRole("button", { name: "继续编辑草稿", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator("article h3").first()).toContainText("远行干粮");
});

test("recovered stale draft cannot overwrite a teammate and local private recovery stays private", async ({
  page,
  context,
}) => {
  await page.route("https://images.example.org/secret.png", (route) =>
    route.fulfill({ status: 404, body: "not found" }),
  );
  await page.goto("/panel.html");
  await page.getByRole("button", { name: "编辑治疗药水", exact: true }).click();
  await page.getByLabel("物品说明", { exact: true }).fill("旧草稿");
  await page.reload();
  const other = await context.newPage();
  await other.goto("/panel.html");
  await other
    .getByRole("button", { name: "编辑治疗药水", exact: true })
    .click();
  await other.getByLabel("名称", { exact: true }).fill("队友改过的药水");
  await other.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑草稿", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("队友修改");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: /^插画/ }).click();
  await page.getByRole("button", { name: "从链接导入", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("秘密画面");
  await page
    .getByLabel("图片地址", { exact: true })
    .fill("https://images.example.org/secret.png");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "编辑秘密画面", exact: true }).click();
  await page.getByRole("button", { name: "移除条目", exact: true }).click();
  await page.getByRole("button", { name: "确认移除", exact: true }).click();
  await page.getByRole("button", { name: /^最近删除/ }).click();
  await expect(page.getByRole("dialog")).toContainText("仅 DM 可见");
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator(".visibility-label")).toContainText("仅 DM 可见");
  expect(
    await page.evaluate(() => localStorage.getItem("twisted-moon.demo.v1")),
  ).not.toContain("secret.png");
  await other.close();
});
