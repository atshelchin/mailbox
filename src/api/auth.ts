import { Elysia, t } from "elysia";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/types";
import { db } from "../db";
import { config } from "../config";
import { validateUsername } from "../utils/validation";

// 类型定义
interface User {
  id: string;
  username: string;
  created_at: number;
}

interface Credential {
  id: string;
  user_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
}

interface Challenge {
  id: string;
  user_id: string | null;
  challenge: string;
  type: string;
  expires_at: number;
}

interface Session {
  id: string;
  user_id: string;
  expires_at: number;
}

// 数据库操作
const queries = {
  getUserByUsername: db.prepare<User, [string]>("SELECT * FROM users WHERE username = ?"),
  getUserById: db.prepare<User, [string]>("SELECT * FROM users WHERE id = ?"),
  createUser: db.prepare("INSERT INTO users (id, username) VALUES (?, ?)"),

  getCredentialsByUserId: db.prepare<Credential, [string]>("SELECT * FROM credentials WHERE user_id = ?"),
  getCredentialById: db.prepare<Credential, [string]>("SELECT * FROM credentials WHERE id = ?"),
  createCredential: db.prepare(
    "INSERT INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)"
  ),
  updateCredentialCounter: db.prepare("UPDATE credentials SET counter = ? WHERE id = ?"),

  createChallenge: db.prepare(
    "INSERT INTO challenges (id, user_id, challenge, type, expires_at) VALUES (?, ?, ?, ?, ?)"
  ),
  getChallenge: db.prepare<Challenge, [string, string]>(
    "SELECT * FROM challenges WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1"
  ),
  getChallengeByValue: db.prepare<Challenge, [string, string]>(
    "SELECT * FROM challenges WHERE challenge = ? AND type = ? ORDER BY created_at DESC LIMIT 1"
  ),
  deleteChallenge: db.prepare("DELETE FROM challenges WHERE id = ?"),

  createSession: db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"),
  getSession: db.prepare<Session & { username: string }, [string]>(
    "SELECT s.*, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?"
  ),
  deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
};

function uint8ArrayToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64url");
}

function base64ToUint8Array(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64url"));
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  // 注册 - 获取选项
  .post(
    "/register/options",
    async ({ body }) => {
      const { username } = body;

      // 验证用户名
      const validation = validateUsername(username);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // 检查用户名是否已存在
      const existingUser = queries.getUserByUsername.get(username);
      if (existingUser) {
        return { success: false, error: "Username already exists" };
      }

      // 创建临时用户 ID
      const tempUserId = crypto.randomUUID();

      // 生成注册选项
      const options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpID,
        userName: username,
        userDisplayName: username,
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });

      // 存储挑战
      const challengeExpires = Math.floor(Date.now() / 1000) + 300; // 5 分钟
      queries.createChallenge.run(
        crypto.randomUUID(),
        tempUserId,
        options.challenge,
        "registration",
        challengeExpires
      );

      return {
        success: true,
        options,
        tempUserId,
      };
    },
    {
      body: t.Object({
        username: t.String(),
      }),
    }
  )

  // 注册 - 验证响应
  .post(
    "/register/verify",
    async ({ body, cookie }) => {
      const { username, tempUserId, response } = body;

      // 获取挑战
      const challengeRecord = queries.getChallenge.get(tempUserId, "registration");
      if (!challengeRecord) {
        return { success: false, error: "Challenge not found or expired" };
      }

      if (challengeRecord.expires_at < Math.floor(Date.now() / 1000)) {
        queries.deleteChallenge.run(challengeRecord.id);
        return { success: false, error: "Challenge expired" };
      }

      try {
        const verification = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge: challengeRecord.challenge,
          expectedOrigin: config.allowedOrigins,
          expectedRPID: config.rpID,
        });

        if (!verification.verified || !verification.registrationInfo) {
          return { success: false, error: "Verification failed" };
        }

        // 删除挑战
        queries.deleteChallenge.run(challengeRecord.id);

        // 创建用户
        const userId = crypto.randomUUID();
        queries.createUser.run(userId, username);

        // 存储凭证
        const { credential } = verification.registrationInfo;
        queries.createCredential.run(
          uint8ArrayToBase64(credential.id),
          userId,
          Buffer.from(credential.publicKey),
          credential.counter,
          JSON.stringify(credential.transports || [])
        );

        // 创建 session
        const sessionId = crypto.randomUUID();
        const sessionExpires = Math.floor(Date.now() / 1000) + config.sessionMaxAge / 1000;
        queries.createSession.run(sessionId, userId, sessionExpires);

        cookie.session.set({
          value: sessionId,
          httpOnly: true,
          secure: config.origin.startsWith("https"),
          sameSite: "strict",
          maxAge: config.sessionMaxAge / 1000,
          path: "/",
        });

        return {
          success: true,
          user: { id: userId, username },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    {
      body: t.Object({
        username: t.String(),
        tempUserId: t.String(),
        response: t.Any(),
      }),
    }
  )

  // 登录 - 获取选项
  .post(
    "/login/options",
    async ({ body }) => {
      const { username } = body;

      // 获取用户
      const user = queries.getUserByUsername.get(username);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      // 获取用户的凭证
      const credentials = queries.getCredentialsByUserId.all(user.id);
      if (credentials.length === 0) {
        return { success: false, error: "No credentials found" };
      }

      // 生成认证选项
      const options = await generateAuthenticationOptions({
        rpID: config.rpID,
        allowCredentials: credentials.map((cred) => ({
          id: cred.id,
          transports: cred.transports
            ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
            : undefined,
        })),
        userVerification: "preferred",
      });

      // 存储挑战
      const challengeExpires = Math.floor(Date.now() / 1000) + 300;
      queries.createChallenge.run(
        crypto.randomUUID(),
        user.id,
        options.challenge,
        "authentication",
        challengeExpires
      );

      return {
        success: true,
        options,
        userId: user.id,
      };
    },
    {
      body: t.Object({
        username: t.String(),
      }),
    }
  )

  // 登录 - 验证响应
  .post(
    "/login/verify",
    async ({ body, cookie }) => {
      const { userId, response } = body;

      // 获取用户
      const user = queries.getUserById.get(userId);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      // 获取挑战
      const challengeRecord = queries.getChallenge.get(userId, "authentication");
      if (!challengeRecord) {
        return { success: false, error: "Challenge not found or expired" };
      }

      if (challengeRecord.expires_at < Math.floor(Date.now() / 1000)) {
        queries.deleteChallenge.run(challengeRecord.id);
        return { success: false, error: "Challenge expired" };
      }

      // 获取凭证
      const credential = queries.getCredentialById.get(response.id);
      if (!credential || credential.user_id !== userId) {
        return { success: false, error: "Credential not found" };
      }

      try {
        const verification = await verifyAuthenticationResponse({
          response: response as AuthenticationResponseJSON,
          expectedChallenge: challengeRecord.challenge,
          expectedOrigin: config.allowedOrigins,
          expectedRPID: config.rpID,
          credential: {
            id: credential.id,
            publicKey: credential.public_key,
            counter: credential.counter,
            transports: credential.transports
              ? (JSON.parse(credential.transports) as AuthenticatorTransportFuture[])
              : undefined,
          },
        });

        if (!verification.verified) {
          return { success: false, error: "Verification failed" };
        }

        // 删除挑战
        queries.deleteChallenge.run(challengeRecord.id);

        // 更新计数器
        queries.updateCredentialCounter.run(
          verification.authenticationInfo.newCounter,
          credential.id
        );

        // 创建 session
        const sessionId = crypto.randomUUID();
        const sessionExpires = Math.floor(Date.now() / 1000) + config.sessionMaxAge / 1000;
        queries.createSession.run(sessionId, userId, sessionExpires);

        cookie.session.set({
          value: sessionId,
          httpOnly: true,
          secure: config.origin.startsWith("https"),
          sameSite: "strict",
          maxAge: config.sessionMaxAge / 1000,
          path: "/",
        });

        return {
          success: true,
          user: { id: userId, username: user.username },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    {
      body: t.Object({
        userId: t.String(),
        response: t.Any(),
      }),
    }
  )

  // 登出
  .post("/logout", ({ cookie }) => {
    const sessionId = cookie.session.value;
    if (sessionId) {
      queries.deleteSession.run(sessionId);
      cookie.session.remove();
    }
    return { success: true };
  })

  // 获取当前用户
  .get("/me", ({ cookie }) => {
    const sessionId = cookie.session.value;
    if (!sessionId) {
      return { success: false, error: "Not authenticated" };
    }

    const session = queries.getSession.get(sessionId);
    if (!session) {
      return { success: false, error: "Session not found" };
    }

    if (session.expires_at < Math.floor(Date.now() / 1000)) {
      queries.deleteSession.run(sessionId);
      return { success: false, error: "Session expired" };
    }

    return {
      success: true,
      user: { id: session.user_id, username: session.username },
    };
  });

// 认证中间件
export function getAuthUser(sessionId: string | undefined): { id: string; username: string } | null {
  if (!sessionId) return null;

  const session = queries.getSession.get(sessionId);
  if (!session) return null;

  if (session.expires_at < Math.floor(Date.now() / 1000)) {
    queries.deleteSession.run(sessionId);
    return null;
  }

  return { id: session.user_id, username: session.username };
}
