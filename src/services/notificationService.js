const { query, testConnection } = require('../config/db');

/**
 * Check if location is India using strict boundary regex
 */
function isIndiaLocation(locationStr) {
  if (!locationStr || typeof locationStr !== 'string') return false;
  const normalized = locationStr.trim();
  if (/\bIndia\b/i.test(normalized)) return true;
  const indianTechHubsRegex = /\b(Bengaluru|Bangalore|Mumbai|Pune|Hyderabad|Chennai|Delhi|Gurgaon|Gurugram|Noida|NCR|Kolkata|Ahmedabad)\b/i;
  return indianTechHubsRegex.test(normalized);
}

/**
 * Evaluates whether an ingested job qualifies as a High-Value Alert.
 * If qualified and persistDb is true, persists to job_notifications table with UNIQUE dedup.
 */
async function evaluateAndNotifyJob(job, matchEval, options = {}) {
  try {
    if (!job || !matchEval) return false;

    // Requirement 1: Keep notifications strictly for real jobs only
    if (job.sourceName === 'MockSource' || (job.externalJobId && String(job.externalJobId).startsWith('MOCK-'))) {
      return false;
    }

    // Requirement 3: Check Location (India focus)
    if (!isIndiaLocation(job.location)) {
      return false;
    }

    // Requirement 3: Check Freshness (Must be <= 48h: VERY_FRESH or FRESH)
    const freshCat = matchEval.freshness?.category;
    if (freshCat !== 'VERY_FRESH' && freshCat !== 'FRESH') {
      return false;
    }

    // Requirement 3: Check Score & Priority (High Match Score >= 75 or APPLY_NOW / HIGH_PRIORITY)
    const finalScore = matchEval.scores?.finalMatchScore || 0;
    const priority = matchEval.priority;

    if (finalScore < 75.00 && priority !== 'APPLY_NOW' && priority !== 'HIGH_PRIORITY') {
      return false;
    }

    // If unit test or persistDb === false, return qualification status without DB mutation
    if (options.persistDb === false) {
      return true;
    }

    const dbStatus = await testConnection();
    if (!dbStatus.connected) return false;

    // Lookup numeric job.id from MySQL if not attached directly
    let dbJobId = job.id;
    if (!dbJobId && job.dedupHash) {
      const jobRows = await query('SELECT id FROM jobs WHERE dedup_hash = ? LIMIT 1', [job.dedupHash]);
      if (jobRows && jobRows.length > 0) {
        dbJobId = jobRows[0].id;
      }
    }

    if (!dbJobId) return false;

    // Requirement 2: Insert into job_notifications with INSERT IGNORE (UNIQUE(user_id, job_id))
    const notificationType = freshCat === 'VERY_FRESH' ? 'VERY_FRESH_HIGH_MATCH' : 'NEW_TARGET_JOB';
    const insertSql = `
      INSERT IGNORE INTO job_notifications (
        user_id, job_id, priority, match_score, notification_type, is_read
      ) VALUES (?, ?, ?, ?, ?, FALSE);
    `;

    await query(insertSql, [
      1,
      dbJobId,
      priority || 'HIGH_PRIORITY',
      finalScore,
      notificationType
    ]);

    return true;

  } catch (err) {
    console.warn(`[Notification Qualification Warning for ${job.externalJobId}]:`, err.message);
    return false;
  }
}

/**
 * Retrieves candidate notifications list and unread count
 */
async function getCandidateNotifications(userId = 1) {
  try {
    const dbStatus = await testConnection();
    if (!dbStatus.connected) {
      return { unreadCount: 0, notifications: [] };
    }

    const sql = `
      SELECT 
        n.id, n.job_id, n.priority, n.match_score, n.notification_type, n.is_read, n.created_at,
        j.title AS job_title, j.company, j.location, j.job_url, j.posted_at, j.posted_at_precision
      FROM job_notifications n
      JOIN jobs j ON n.job_id = j.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50;
    `;

    const notifications = await query(sql, [userId]);
    const unreadRes = await query('SELECT COUNT(*) AS count FROM job_notifications WHERE user_id = ? AND is_read = FALSE', [userId]);
    const unreadCount = unreadRes && unreadRes.length > 0 ? unreadRes[0].count : 0;

    return {
      unreadCount,
      notifications: notifications.map(n => ({
        id: n.id,
        jobId: n.job_id,
        priority: n.priority,
        matchScore: parseFloat(n.match_score),
        notificationType: n.notification_type,
        isRead: Boolean(n.is_read),
        createdAt: n.created_at,
        jobTitle: n.job_title,
        company: n.company,
        location: n.location,
        jobUrl: n.job_url,
        postedAt: n.posted_at
      }))
    };
  } catch (err) {
    console.error('Failed to get candidate notifications:', err.message);
    return { unreadCount: 0, notifications: [] };
  }
}

/**
 * Marks a notification as read
 */
async function markNotificationAsRead(notificationId, userId = 1) {
  try {
    await query('UPDATE job_notifications SET is_read = TRUE WHERE id = ? AND user_id = ?', [notificationId, userId]);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Marks all candidate notifications as read
 */
async function markAllNotificationsAsRead(userId = 1) {
  try {
    await query('UPDATE job_notifications SET is_read = TRUE WHERE user_id = ?', [userId]);
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  evaluateAndNotifyJob,
  getCandidateNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  isIndiaLocation
};
