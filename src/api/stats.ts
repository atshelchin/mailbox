/**
 * @fileoverview Statistics API
 * @description Provides system-wide statistics and dashboard data.
 * @module api/stats
 */

import { Elysia } from "elysia";
import { db } from "../db";
import { getStats as getAntispamStats } from "../smtp/antispam";

// ============================================================================
// Database Queries
// ============================================================================

const queries = {
  // User statistics
  totalUsers: db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM users"
  ),
  activeUsers24h: db.prepare<{ count: number }, []>(
    "SELECT COUNT(DISTINCT user_id) as count FROM sessions WHERE created_at > datetime('now', '-24 hours')"
  ),

  // Domain statistics
  totalDomains: db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM domains"
  ),
  verifiedDomains: db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM domains WHERE verified = 1"
  ),
  officialDomains: db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM domains WHERE is_official = 1"
  ),
  autoDiscoveredDomains: db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM domains WHERE auto_discovered = 1"
  ),

  // Mailbox statistics
  totalMailboxes: db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM mailboxes"
  ),

  // Email statistics
  totalEmails: db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM emails"
  ),
  emailsToday: db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM emails WHERE received_at > unixepoch() - 86400"
  ),
  totalEmailSize: db.prepare<{ total: number | null }, []>(
    "SELECT SUM(size) as total FROM emails"
  ),

  // Attachment statistics
  totalAttachments: db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM attachments"
  ),
  totalAttachmentSize: db.prepare<{ total: number | null }, []>(
    "SELECT SUM(size) as total FROM attachments"
  ),

  // Top domains by mailbox count (public domains only, visibility = 0)
  topDomainsByMailboxes: db.prepare<{ name: string; count: number }, []>(`
    SELECT d.name, COUNT(m.id) as count
    FROM domains d
    LEFT JOIN mailboxes m ON d.id = m.domain_id
    WHERE d.visibility = 0
    GROUP BY d.id
    ORDER BY count DESC
    LIMIT 10
  `),

  // Top domains by email count (public domains only, visibility = 0)
  topDomainsByEmails: db.prepare<{ name: string; count: number }, []>(`
    SELECT d.name, COUNT(e.id) as count
    FROM domains d
    LEFT JOIN mailboxes m ON d.id = m.domain_id
    LEFT JOIN emails e ON m.id = e.mailbox_id
    WHERE d.visibility = 0
    GROUP BY d.id
    ORDER BY count DESC
    LIMIT 10
  `),

  // Recent activity
  recentEmails: db.prepare<{ hour: string; count: number }, []>(`
    SELECT strftime('%Y-%m-%d %H:00', received_at, 'unixepoch') as hour, COUNT(*) as count
    FROM emails
    WHERE received_at > unixepoch() - 86400
    GROUP BY hour
    ORDER BY hour DESC
  `),
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getSystemStats() {
  const memUsage = process.memoryUsage();
  return {
    uptime: process.uptime(),
    memory: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      heapUsedFormatted: formatBytes(memUsage.heapUsed),
      heapTotalFormatted: formatBytes(memUsage.heapTotal),
      rssFormatted: formatBytes(memUsage.rss),
    },
    platform: process.platform,
    nodeVersion: process.version,
  };
}

// ============================================================================
// Routes
// ============================================================================

export const statsRoutes = new Elysia({ prefix: "/stats" })
  /**
   * Get system statistics
   * @route GET /api/stats
   * @description Returns comprehensive system statistics including
   * user counts, domain stats, email metrics, and resource usage.
   */
  .get("/", () => {
    const totalEmailSizeResult = queries.totalEmailSize.get();
    const totalAttachmentSizeResult = queries.totalAttachmentSize.get();
    const totalEmailSize = totalEmailSizeResult?.total || 0;
    const totalAttachmentSize = totalAttachmentSizeResult?.total || 0;

    return {
      success: true,
      timestamp: new Date().toISOString(),
      users: {
        total: queries.totalUsers.get()?.count || 0,
        active24h: queries.activeUsers24h.get()?.count || 0,
      },
      domains: {
        total: queries.totalDomains.get()?.count || 0,
        verified: queries.verifiedDomains.get()?.count || 0,
        official: queries.officialDomains.get()?.count || 0,
        autoDiscovered: queries.autoDiscoveredDomains.get()?.count || 0,
      },
      mailboxes: {
        total: queries.totalMailboxes.get()?.count || 0,
      },
      emails: {
        total: queries.totalEmails.get()?.count || 0,
        today: queries.emailsToday.get()?.count || 0,
        totalSize: totalEmailSize,
        totalSizeFormatted: formatBytes(totalEmailSize),
      },
      attachments: {
        total: queries.totalAttachments.get()?.count || 0,
        totalSize: totalAttachmentSize,
        totalSizeFormatted: formatBytes(totalAttachmentSize),
      },
      storage: {
        total: totalEmailSize + totalAttachmentSize,
        totalFormatted: formatBytes(totalEmailSize + totalAttachmentSize),
      },
      antispam: getAntispamStats(),
      system: getSystemStats(),
    };
  })

  /**
   * Get top domains statistics
   * @route GET /api/stats/top-domains
   * @description Returns top domains by mailbox and email counts
   */
  .get("/top-domains", () => {
    return {
      success: true,
      byMailboxes: queries.topDomainsByMailboxes.all(),
      byEmails: queries.topDomainsByEmails.all(),
    };
  })

  /**
   * Get email activity timeline
   * @route GET /api/stats/activity
   * @description Returns hourly email counts for the last 24 hours
   */
  .get("/activity", () => {
    return {
      success: true,
      hourly: queries.recentEmails.all(),
    };
  });
