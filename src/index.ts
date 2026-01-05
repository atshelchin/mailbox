import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import "./db"; // 数据库会在导入时自动初始化
import { apiRoutes } from "./api";
import { startSMTPServer } from "./smtp/server";
import { startCleanupJob } from "./services/cleanup";
import { config } from "./config";

console.log("Database initialized");

// 创建 HTTP 服务器
const app = new Elysia()
  .use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    })
  )
  .get("/", () => ({
    name: "Mailbox Service",
    version: "1.0.0",
    service: config.serviceDomain,
    officialDomains: config.officialDomains,
  }))
  .get("/health", () => ({ status: "ok", timestamp: Date.now() }))
  .use(apiRoutes)
  .listen(config.httpPort);

console.log(`HTTP server listening on ${config.host}:${config.httpPort}`);

// 启动 SMTP 服务器
startSMTPServer();

// 启动定时清理任务
startCleanupJob();

// 优雅关闭
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down...");
  process.exit(0);
});

export { app };
