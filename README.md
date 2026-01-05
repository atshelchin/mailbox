# Mailbox Service

一个轻量级的邮件接收服务，支持多域名、Passkeys 认证，基于 Bun + Elysia 构建。

## 功能特性

- **多域名支持**: 单一服务实例支持多个邮箱域名
- **Passkeys 认证**: 无密码登录，基于 WebAuthn 标准
- **邮箱地址抢注**: 用户可以注册官方域名下的邮箱地址
- **自定义域名**: 支持用户绑定自己的域名（TXT 记录验证）
- **定时清理**: 邮件内容 24 小时自动清理
- **附件支持**: 最大 100MB 附件

## 快速开始

### 本地开发

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev
```

服务将在以下端口启动：
- HTTP API: http://localhost:5000
- SMTP: localhost:25

### Docker 部署

```bash
# 构建镜像
docker build -t mailbox:latest .

# 运行容器
docker run -d \
  -p 5000:5000 \
  -p 25:25 \
  -v mailbox-data:/data \
  -e SERVICE_DOMAIN=mailbox.example.com \
  -e OFFICIAL_DOMAINS=test1.example.com,test2.example.com \
  -e RP_ID=mail.example.com \
  -e ORIGIN=https://mail.example.com \
  -e SESSION_SECRET=your-secret-here \
  mailbox:latest
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `HOST` | 监听地址 | `0.0.0.0` |
| `HTTP_PORT` | HTTP 端口 | `5000` |
| `SMTP_PORT` | SMTP 端口 | `25` |
| `SERVICE_DOMAIN` | 服务域名 | `mailbox.0x0.run` |
| `OFFICIAL_DOMAINS` | 官方邮箱域名 (逗号分隔) | `test1.0x0.run,test2.0x0.run` |
| `RP_NAME` | WebAuthn RP 名称 | `Mailbox` |
| `RP_ID` | WebAuthn RP ID (前端域名) | `mailbox.0x0.run` |
| `ORIGIN` | WebAuthn Origin (前端 URL) | `https://mailbox.0x0.run` |
| `ALLOWED_ORIGINS` | 允许的 Origins (逗号分隔) | 同 `ORIGIN` |
| `CORS_ORIGINS` | CORS 允许的域名 (逗号分隔) | 同 `ORIGIN` |
| `MAX_EMAIL_SIZE` | 最大邮件大小 (字节) | `104857600` (100MB) |
| `EMAIL_RETENTION_HOURS` | 邮件保留时间 (小时) | `24` |
| `DB_PATH` | SQLite 数据库路径 | `./mailbox.db` |
| `SESSION_SECRET` | Session 密钥 | `change-this-secret-in-production` |
| `SESSION_MAX_AGE` | Session 有效期 (毫秒) | `604800000` (7天) |

## API 文档

### 认证 API

```
POST /api/auth/register/options  - 获取 Passkey 注册选项
POST /api/auth/register/verify   - 验证 Passkey 注册
POST /api/auth/login/options     - 获取 Passkey 登录选项
POST /api/auth/login/verify      - 验证 Passkey 登录
POST /api/auth/logout            - 登出
GET  /api/auth/me                - 获取当前用户信息
```

### 域名 API

```
GET    /api/domains              - 获取所有可用域名
GET    /api/domains/mine         - 获取用户的自定义域名
POST   /api/domains              - 添加自定义域名
GET    /api/domains/:id/verify   - 获取域名验证信息
POST   /api/domains/:id/verify   - 验证域名所有权
DELETE /api/domains/:id          - 删除自定义域名
```

### 邮箱 API

```
GET    /api/mailboxes            - 获取用户的邮箱列表
POST   /api/mailboxes            - 注册邮箱地址
GET    /api/mailboxes/:id        - 获取邮箱详情
DELETE /api/mailboxes/:id        - 删除邮箱
```

### 邮件 API

```
GET    /api/emails/mailbox/:id   - 获取邮箱的邮件列表
GET    /api/emails/:id           - 获取邮件详情
GET    /api/emails/:id/raw       - 下载原始邮件
DELETE /api/emails/:id           - 删除邮件
GET    /api/attachments/:id      - 下载附件
```

## 自定义域名接入

### 1. 添加域名

调用 API 添加您的域名：

```bash
curl -X POST https://mailbox-api.appsdata.xyz/api/domains \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION" \
  -d '{"name": "yourdomain.com"}'
```

### 2. 配置 DNS

在您的域名 DNS 中添加以下记录：

**MX 记录** (必须)
```
类型: MX
主机: @ 或 yourdomain.com
值: mail.0x0.run
优先级: 10
```

**TXT 记录** (用于验证)
```
类型: TXT
主机: _mailbox-verify 或 @
值: mailbox-verify=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 3. 验证域名

DNS 记录生效后，调用验证 API：

```bash
curl -X POST https://mailbox-api.appsdata.xyz/api/domains/{domain_id}/verify \
  -H "Cookie: session=YOUR_SESSION"
```

### 4. 创建邮箱

域名验证通过后，即可创建邮箱地址：

```bash
curl -X POST https://mailbox-api.appsdata.xyz/api/mailboxes \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION" \
  -d '{"localPart": "hello", "domainId": "YOUR_DOMAIN_ID"}'
```

## GitHub Actions 部署

### 配置 Secrets

在 GitHub 仓库的 Settings → Secrets and variables → Actions 中添加以下 secrets：

| Secret 名称 | 说明 |
|-------------|------|
| `SERVER_HOST` | 服务器 IP 或域名 |
| `SERVER_USER` | SSH 用户名 |
| `SERVER_SSH_KEY` | SSH 私钥 |
| `SERVER_PORT` | SSH 端口 |
| `DEPLOY_PATH` | 部署目录路径 |
| `HTTP_PORT` | HTTP 端口 |
| `SMTP_PORT` | SMTP 端口 |
| `SERVICE_DOMAIN` | 服务域名 |
| `OFFICIAL_DOMAINS` | 官方域名列表 |
| `RP_NAME` | WebAuthn RP 名称 |
| `RP_ID` | WebAuthn RP ID |
| `ORIGIN` | WebAuthn Origin |
| `SESSION_SECRET` | Session 密钥 |
| `MAX_EMAIL_SIZE` | 最大邮件大小 |
| `EMAIL_RETENTION_HOURS` | 邮件保留时间 |

### 部署流程

1. 创建版本标签触发部署：
```bash
git tag v1.0.0
git push origin v1.0.0
```

2. GitHub Actions 会自动：
   - 构建 Docker 镜像
   - 上传到服务器
   - 停止旧容器
   - 启动新容器
   - 执行健康检查

## 服务器配置

### 防火墙

确保以下端口开放：
- **25**: SMTP (接收邮件)
- **5000**: HTTP API (或通过 nginx 反向代理)

### Nginx 反向代理 (可选)

```nginx
server {
    listen 443 ssl;
    server_name mailbox-api.appsdata.xyz;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 注意事项

1. **Passkeys 配置**: `RP_ID` 和 `ORIGIN` 必须设置为前端 WebUI 的域名，而不是后端 API 域名
2. **SMTP 端口**: 端口 25 在云服务器上可能被封禁，需要联系云服务商解封或使用替代端口
3. **邮件清理**: 邮件内容会在 24 小时后自动删除，但邮箱地址保留
4. **Session 密钥**: 生产环境必须设置强随机的 `SESSION_SECRET`

## License

MIT
