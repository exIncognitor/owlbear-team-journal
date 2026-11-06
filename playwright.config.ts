import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  use: {
    channel: "chrome",
    baseURL: "http://127.0.0.1:5183",
    viewport: { width: 760, height: 700 },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5183",
    url: "http://127.0.0.1:5183",
    reuseExistingServer: false,
  },
  reporter: "list",
});
