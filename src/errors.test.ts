import { expect, it } from "vitest";
import { errorMessage } from "./errors";

it("reads Error, postMessage objects, nested errors and validation issues", () => {
  expect(errorMessage(Error("连接失败"))).toBe("连接失败");
  expect(errorMessage({ message: "图库未打开" })).toBe("图库未打开");
  expect(errorMessage({ error: { message: "没有权限" } })).toBe("没有权限");
  expect(
    errorMessage({
      issues: [{ path: ["typeHint"], message: "请选择图片类型" }],
    }),
  ).toBe("请选择图片类型");
});

it("handles empty or cyclic errors without dumping arbitrary data", () => {
  const error: Record<string, unknown> = { token: "do-not-display" };
  error.error = error;
  for (const value of [undefined, null, {}, error])
    expect(errorMessage(value)).toBe("操作失败，请重试");
});
