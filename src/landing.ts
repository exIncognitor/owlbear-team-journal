const url = new URL("/manifest.json", location.origin).href;
document.getElementById("install-url")!.textContent = url;
document.getElementById("copy-install")!.addEventListener("click", async () => {
  const status = document.getElementById("copy-status")!;
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = "安装链接已复制";
  } catch {
    status.textContent = "未能访问剪贴板，请选择上方链接手动复制。";
  }
});
