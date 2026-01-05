import { Elysia } from "elysia";
import { authRoutes } from "./auth";
import { domainRoutes } from "./domains";
import { mailboxRoutes } from "./mailboxes";
import { emailRoutes, attachmentRoutes } from "./emails";

export const apiRoutes = new Elysia({ prefix: "/api" })
  .use(authRoutes)
  .use(domainRoutes)
  .use(mailboxRoutes)
  .use(emailRoutes)
  .use(attachmentRoutes);
