# Mailbox Service API Documentation

A disposable email service API built with Bun + Elysia. Supports WebAuthn/Passkeys authentication and receives emails via SMTP.

## Base URL

- **API**: `https://mailbox-api.appsdata.xyz`
- **Service**: `https://mailbox.0x0.run`
- **MX Target**: `mail.appsdata.xyz`

## Authentication

All API endpoints (except login/register) require authentication via session cookie.

### WebAuthn/Passkeys Flow

1. **Registration**: Create account with username, then register a Passkey
2. **Login**: Authenticate using registered Passkey
3. **Session**: Cookie-based session maintains authenticated state

---

## Authentication Endpoints

### Register - Get Options

Get registration options for creating a new account.

```
POST /api/auth/register/options
```

**Request Body:**
```json
{
  "username": "string"
}
```

**Response:**
```json
{
  "success": true,
  "options": { /* WebAuthn registration options */ },
  "tempUserId": "string"
}
```

**Errors:**
- `Username already exists` - Username is taken
- `Username must be 3-32 characters` - Invalid length
- `Username can only contain letters, numbers, underscore and hyphen` - Invalid format

---

### Register - Verify

Complete registration with the Passkey response.

```
POST /api/auth/register/verify
```

**Request Body:**
```json
{
  "username": "string",
  "tempUserId": "string",
  "response": { /* WebAuthn response */ }
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "string",
    "username": "string"
  }
}
```

**Side Effects:**
- Creates user account
- Stores credential
- Sets session cookie

---

### Login - Get Options

Get authentication options for an existing user.

```
POST /api/auth/login/options
```

**Request Body:**
```json
{
  "username": "string"
}
```

**Response:**
```json
{
  "success": true,
  "options": { /* WebAuthn authentication options */ },
  "userId": "string"
}
```

**Errors:**
- `User not found` - Username doesn't exist
- `No credentials found` - User has no registered Passkeys

---

### Login - Verify

Complete login with the Passkey response.

```
POST /api/auth/login/verify
```

**Request Body:**
```json
{
  "userId": "string",
  "response": { /* WebAuthn response */ }
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "string",
    "username": "string"
  }
}
```

**Side Effects:**
- Sets session cookie
- Updates credential counter

---

### Logout

End the current session.

```
POST /api/auth/logout
```

**Response:**
```json
{
  "success": true
}
```

**Side Effects:**
- Deletes session from database
- Removes session cookie

---

### Get Current User

Get info about the authenticated user.

```
GET /api/auth/me
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "string",
    "username": "string"
  }
}
```

**Errors:**
- `Unauthorized` - Not logged in or session expired

---

## Domain Endpoints

### Domain Visibility

Domains have three visibility levels:
- **Private (0)**: Only owner can create mailboxes
- **Partial (1)**: Owner and allowed users can create mailboxes
- **Public (2)**: Anyone can create mailboxes

### Domain Verification Methods

Two methods are supported:
- **TXT Record**: Add a TXT record with verification token
- **MX Record**: Point MX record to `mail.appsdata.xyz`

### Auto-Discovery

When SMTP server receives email for an unknown domain:
1. Checks if domain's MX record points to our mail server
2. If yes, automatically registers domain as public (visibility=2)
3. Users can then create mailboxes on this domain

---

### List Available Domains

Get all domains accessible to the current user.

```
GET /api/domains
```

**Response:**
```json
{
  "success": true,
  "domains": [
    {
      "id": "string",
      "name": "string",
      "isOfficial": true,
      "isMine": false,
      "visibility": 2,
      "verifiedBy": "mx"
    }
  ]
}
```

**Notes:**
- Returns domains user can create mailboxes on:
  - Official domains (always public)
  - Public verified domains (visibility=2)
  - User's own domains
  - Domains where user is in allowed list (visibility=1)

---

### List My Domains

Get domains owned by the current user.

```
GET /api/domains/mine
```

**Response:**
```json
{
  "success": true,
  "domains": [
    {
      "id": "string",
      "name": "string",
      "txtRecord": "string",
      "verified": true,
      "verifiedBy": "txt",
      "visibility": 0,
      "autoDiscovered": false,
      "allowedUsers": 3,
      "createdAt": 1704067200
    }
  ]
}
```

---

### Add Custom Domain

Register a new custom domain.

```
POST /api/domains
```

**Request Body:**
```json
{
  "name": "string",
  "verifyByMx": false
}
```

**Response (TXT verification):**
```json
{
  "success": true,
  "domain": {
    "id": "string",
    "name": "string",
    "txtRecord": "mailbox-verify=xxx-xxx-xxx",
    "verified": false
  }
}
```

**Response (MX verification):**
```json
{
  "success": true,
  "domain": {
    "id": "string",
    "name": "string",
    "verifyByMx": true,
    "mxTarget": "mail.appsdata.xyz",
    "verified": false
  }
}
```

**Errors:**
- `Cannot add official domain` - Domain is a system domain
- `Domain already exists` - Domain is already registered
- `Invalid domain format` - Domain name is invalid

---

### Get Verification Info

Get DNS verification instructions.

```
GET /api/domains/:id/verify
```

**Response (TXT mode, not verified):**
```json
{
  "success": true,
  "verified": false,
  "verifyByMx": false,
  "domain": "example.com",
  "txtRecord": "mailbox-verify=xxx-xxx-xxx",
  "instructions": "Add a TXT record to your domain..."
}
```

**Response (MX mode, not verified):**
```json
{
  "success": true,
  "verified": false,
  "verifyByMx": true,
  "domain": "example.com",
  "mxTarget": "mail.appsdata.xyz",
  "currentMx": [
    { "priority": 10, "exchange": "mail.example.com" }
  ],
  "instructions": "Add an MX record to your domain..."
}
```

**Response (already verified):**
```json
{
  "success": true,
  "verified": true,
  "verifiedBy": "txt"
}
```

---

### Verify Domain

Trigger DNS verification check.

```
POST /api/domains/:id/verify
```

**Response:**
```json
{
  "success": true,
  "verified": true,
  "verifiedBy": "mx"
}
```

**Errors:**
- `TXT record not found...` - TXT verification failed
- `MX record not found...` - MX verification failed

**DNS Record Formats Accepted:**

For TXT verification:
- `_mailbox-verify.example.com` TXT `mailbox-verify=xxx`
- `example.com` TXT `mailbox-verify=xxx`

For MX verification:
- `example.com` MX `10 mail.appsdata.xyz`

---

### Update Domain Visibility

Change who can create mailboxes on a domain.

```
PATCH /api/domains/:id/visibility
```

**Request Body:**
```json
{
  "visibility": 2
}
```

**Response:**
```json
{
  "success": true,
  "visibility": 2,
  "visibilityLabel": "public"
}
```

**Visibility Values:**
- `0` - private (owner only)
- `1` - partial (owner + allowed users)
- `2` - public (anyone)

---

### Get Allowed Users

Get users allowed to create mailboxes on a domain.

```
GET /api/domains/:id/allowed-users
```

**Response:**
```json
{
  "success": true,
  "allowedUsers": [
    {
      "id": "string",
      "username": "john",
      "addedAt": 1704067200
    }
  ]
}
```

---

### Add Allowed User

Allow a user to create mailboxes on a domain (for partial visibility).

```
POST /api/domains/:id/allowed-users
```

**Request Body:**
```json
{
  "username": "string"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "string",
    "username": "john"
  }
}
```

**Errors:**
- `User not found` - Username doesn't exist
- `User is already allowed on this domain` - Already in list

---

### Remove Allowed User

Remove a user from allowed list.

```
DELETE /api/domains/:id/allowed-users/:userId
```

**Response:**
```json
{
  "success": true
}
```

---

### Delete Domain

Delete a custom domain.

```
DELETE /api/domains/:id
```

**Response:**
```json
{
  "success": true
}
```

**Errors:**
- `Cannot delete official domain` - System domains cannot be deleted
- `Not your domain` - Domain belongs to another user

**Side Effects:**
- Cascades delete to all mailboxes on this domain

---

## Mailbox Endpoints

### List Mailboxes

Get all mailboxes owned by the current user.

```
GET /api/mailboxes
```

**Response:**
```json
{
  "success": true,
  "mailboxes": [
    {
      "id": "string",
      "address": "user@example.com",
      "localPart": "user",
      "domain": "example.com",
      "createdAt": 1704067200
    }
  ]
}
```

---

### Create Mailbox

Register a new email address.

```
POST /api/mailboxes
```

**Request Body:**
```json
{
  "localPart": "string",
  "domainId": "string"
}
```

**Response:**
```json
{
  "success": true,
  "mailbox": {
    "id": "string",
    "address": "user@example.com",
    "localPart": "user",
    "domain": "example.com"
  }
}
```

**Errors:**
- `This email address is already taken` - Address exists
- `Domain not verified` - Custom domain not verified yet
- `You don't have permission to create mailboxes on this domain` - Domain access denied
- `Maximum mailboxes per user reached` - Limit of 100 mailboxes
- `This email address is reserved` - Reserved local part (admin, postmaster, etc.)

**Reserved Local Parts:**
`admin`, `administrator`, `postmaster`, `hostmaster`, `webmaster`, `abuse`, `noreply`, `no-reply`, `mailer-daemon`, `root`, `support`, `info`, `contact`, `security`, `ssl`, `ftp`, `mail`, `www`, `ns1`, `ns2`, `localhost`, `test`

---

### Get Mailbox Details

Get details of a specific mailbox.

```
GET /api/mailboxes/:id
```

**Response:**
```json
{
  "success": true,
  "mailbox": {
    "id": "string",
    "address": "user@example.com",
    "localPart": "user",
    "domain": "example.com",
    "createdAt": 1704067200
  }
}
```

---

### Delete Mailbox

Delete a mailbox and all its emails.

```
DELETE /api/mailboxes/:id
```

**Response:**
```json
{
  "success": true
}
```

**Side Effects:**
- Cascades delete to all emails and attachments

---

## Email Endpoints

### List Emails

Get emails in a mailbox.

```
GET /api/emails/mailbox/:mailboxId
```

**Response:**
```json
{
  "success": true,
  "mailbox": {
    "id": "string",
    "address": "user@example.com"
  },
  "total": 5,
  "emails": [
    {
      "id": "string",
      "from": "sender@example.com",
      "to": "user@example.com",
      "subject": "Hello",
      "size": 1234,
      "receivedAt": 1704067200
    }
  ]
}
```

**Notes:**
- Sorted by received date (newest first)
- Limited to 100 emails per request

---

### Get Email Details

Get full email content.

```
GET /api/emails/:id
```

**Response:**
```json
{
  "success": true,
  "email": {
    "id": "string",
    "from": "sender@example.com",
    "to": "user@example.com",
    "subject": "Hello",
    "textBody": "Plain text content",
    "htmlBody": "<html>...</html>",
    "size": 1234,
    "receivedAt": 1704067200,
    "attachments": [
      {
        "id": "string",
        "filename": "document.pdf",
        "contentType": "application/pdf",
        "size": 5678
      }
    ]
  }
}
```

---

### Download Raw Email

Download the original email in .eml format.

```
GET /api/emails/:id/raw
```

**Response:**
- Content-Type: `message/rfc822`
- Content-Disposition: `attachment; filename="email-{id}.eml"`

---

### Delete Email

Delete an email and its attachments.

```
DELETE /api/emails/:id
```

**Response:**
```json
{
  "success": true
}
```

---

## Attachment Endpoints

### Download Attachment

Download an email attachment.

```
GET /api/attachments/:id
```

**Response:**
- Content-Type: Based on attachment (e.g., `application/pdf`)
- Content-Disposition: `attachment; filename="{filename}"`

---

## SMTP Server

The service includes an SMTP server for receiving emails.

### Configuration

- **Port**: 25 (configurable)
- **Host**: 0.0.0.0
- **Max Email Size**: 100MB (configurable)
- **MX Target**: `mail.appsdata.xyz`

### Behavior

1. Accepts connections from any sender
2. Validates recipients:
   - Domain must be official or verified
   - If domain is unknown, checks MX record:
     - If MX points to our server, auto-registers domain as public
   - Mailbox must be registered
3. Stores email with:
   - Parsed subject, text body, HTML body
   - Raw email (.eml format)
   - Attachments (stored in SQLite BLOB)

### Auto-Discovery

When receiving email for an unknown domain:
1. System checks if domain's MX record points to `mail.appsdata.xyz`
2. If yes, domain is automatically registered as public (visibility=2)
3. The domain is marked as auto-discovered and verified by MX
4. Any user can then create mailboxes on this domain

### Rejection Reasons

- `Invalid recipient address` - Malformed email address
- `Domain not found` - Domain not registered and MX doesn't point to us
- `Mailbox not found` - No such mailbox registered
- `Message too large` - Exceeds size limit

---

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message"
}
```

### Common Errors

| Error | Description |
|-------|-------------|
| `Unauthorized` | Not logged in or session expired |
| `Not found` | Resource doesn't exist |
| `Not your {resource}` | Resource belongs to another user |

---

## Rate Limits

Currently no rate limiting implemented. Consider adding for production:

- Registration: 10/hour per IP
- Login attempts: 5/minute per username
- API requests: 100/minute per user

---

## Data Retention

- **Sessions**: Expire after 7 days (configurable)
- **Emails**: Retained for 1 hour by default (configurable)
- **Challenges**: Expire after 5 minutes

---

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_PORT` | 5005 | HTTP API port |
| `SMTP_PORT` | 25 | SMTP server port |
| `HOST` | 0.0.0.0 | Bind address |
| `DB_PATH` | mailbox.db | SQLite database path |
| `SERVICE_DOMAIN` | mailbox.0x0.run | Service domain |
| `MX_TARGET_HOST` | mail.appsdata.xyz | MX record target for verification |
| `OFFICIAL_DOMAINS` | test1.0x0.run,test2.0x0.run | Official domains (comma-separated) |
| `MAX_EMAIL_SIZE` | 104857600 | Max email size (bytes, default 100MB) |
| `EMAIL_RETENTION_HOURS` | 1 | Email retention period |
| `SESSION_MAX_AGE` | 604800000 | Session duration (ms, default 7 days) |
