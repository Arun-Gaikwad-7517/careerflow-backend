const { query, testConnection } = require('../config/db');
const { calculateFreshness } = require('../utils/freshness');

/**
 * Helper to check if location is India
 */
function isIndiaLocation(locationStr) {
  if (!locationStr || typeof locationStr !== 'string') return false;
  const normalized = locationStr.trim();
  if (/\bIndia\b/i.test(normalized)) return true;
  const indianTechHubsRegex = /\b(Bengaluru|Bangalore|Mumbai|Pune|Hyderabad|Chennai|Delhi|Gurgaon|Gurugram|Noida|NCR|Kolkata|Ahmedabad)\b/i;
  return indianTechHubsRegex.test(normalized);
}

/**
 * GET /api/v1/admin/stats
 * Protected by authMiddleware + requireAdmin
 */
async function getAdminStats(req, res) {
  try {
    const dbStatus = await testConnection();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        error: 'Database connection service unavailable.'
      });
    }

    const referenceTime = new Date();

    // 1. All Jobs
    const allJobs = await query(`
      SELECT 
        j.id, j.title, j.company, j.location, j.is_remote,
        j.description, j.posted_at, j.posted_at_precision, s.source_name
      FROM jobs j
      JOIN job_sources s ON j.source_id = s.id
      WHERE s.source_name != 'MockSource' AND j.external_job_id NOT LIKE 'MOCK-%'
    `);

    let veryFreshCount = 0;
    let freshCount = 0;
    let notFreshCount = 0;
    let unknownFreshnessCount = 0;
    let indiaJobsCount = 0;

    let nodejsJobsCount = 0;
    let backendJobsCount = 0;
    let fullstackJobsCount = 0;
    let mernJobsCount = 0;

    allJobs.forEach(job => {
      // Freshness
      if (!job.posted_at || job.posted_at_precision === 'UNKNOWN') {
        unknownFreshnessCount++;
      } else {
        const freshEval = calculateFreshness(job.posted_at, job.posted_at_precision, referenceTime);
        if (freshEval.category === 'VERY_FRESH') veryFreshCount++;
        else if (freshEval.category === 'FRESH') freshCount++;
        else if (freshEval.category === 'NOT_FRESH') notFreshCount++;
        else unknownFreshnessCount++;
      }

      // Location
      if (isIndiaLocation(job.location)) {
        indiaJobsCount++;
      }

      // Target Roles
      const textToSearch = `${job.title} ${job.description || ''}`;
      const titleOnly = job.title || '';

      if (/\b(Node\.js|NodeJS|Node)\b/i.test(titleOnly) || /\b(Node\.js|NodeJS)\b/i.test(textToSearch)) nodejsJobsCount++;
      if (/\bBackend\b/i.test(titleOnly) || /\bBackend\b/i.test(textToSearch)) backendJobsCount++;
      if (/\b(Full\s*Stack|Fullstack)\b/i.test(titleOnly) || /\b(Full\s*Stack|Fullstack)\b/i.test(textToSearch)) fullstackJobsCount++;
      if (/\bMERN\b/i.test(titleOnly) || /\bMERN\b/i.test(textToSearch)) mernJobsCount++;
    });

    // 2. Jobs by Source
    const sourceBreakdownRows = await query(`
      SELECT 
        s.source_name,
        s.source_type,
        s.is_active,
        s.last_fetched_at,
        COUNT(j.id) AS total_jobs
      FROM job_sources s
      LEFT JOIN jobs j ON s.id = j.source_id
      WHERE s.source_name != 'MockSource'
      GROUP BY s.id, s.source_name, s.source_type, s.is_active, s.last_fetched_at
      ORDER BY total_jobs DESC
    `);

    // 3. Application Statistics by Status
    const appStatsRows = await query(`
      SELECT 
        current_status,
        COUNT(*) AS count
      FROM applications
      GROUP BY current_status
    `);

    const applicationStats = {
      DRAFT: 0,
      READY_FOR_REVIEW: 0,
      APPLIED: 0,
      INTERVIEWING: 0,
      OFFER: 0,
      REJECTED: 0,
      WITHDRAWN: 0
    };

    appStatsRows.forEach(row => {
      if (applicationStats[row.current_status] !== undefined) {
        applicationStats[row.current_status] = parseInt(row.count, 10);
      }
    });

    // 4. Job Notification Telemetry
    const notifRows = await query(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN is_read = FALSE THEN 1 ELSE 0 END) AS unread
      FROM job_notifications
    `);

    const totalNotifications = notifRows && notifRows.length > 0 ? parseInt(notifRows[0].total || 0, 10) : 0;
    const unreadNotifications = notifRows && notifRows.length > 0 ? parseInt(notifRows[0].unread || 0, 10) : 0;

    return res.status(200).json({
      success: true,
      timestamp: referenceTime.toISOString(),
      metrics: {
        totalRealJobs: allJobs.length,
        veryFreshCount,
        freshCount,
        notFreshCount,
        unknownFreshnessCount,
        indiaJobsCount,
        targetRoleMetrics: {
          nodejs: nodejsJobsCount,
          backend: backendJobsCount,
          fullstack: fullstackJobsCount,
          mern: mernJobsCount
        },
        notifications: {
          total: totalNotifications,
          unread: unreadNotifications
        }
      },
      sources: sourceBreakdownRows.map(s => ({
        sourceName: s.source_name,
        sourceType: s.source_type,
        isActive: Boolean(s.is_active),
        lastFetchedAt: s.last_fetched_at,
        totalJobs: parseInt(s.total_jobs, 10)
      })),
      applicationStats
    });

  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve admin stats.'
    });
  }
}

/**
 * GET /api/v1/admin/jobs
 */
async function getAdminJobs(req, res) {
  try {
    const jobs = await query(`
      SELECT 
        j.id, j.external_job_id, j.title, j.company, j.location, j.is_remote,
        j.posted_at, j.posted_at_precision, j.discovered_at, s.source_name
      FROM jobs j
      JOIN job_sources s ON j.source_id = s.id
      WHERE s.source_name != 'MockSource' AND j.external_job_id NOT LIKE 'MOCK-%'
      ORDER BY j.discovered_at DESC
      LIMIT 100
    `);

    return res.status(200).json({
      success: true,
      count: jobs.length,
      jobs
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve admin jobs.'
    });
  }
}

/**
 * GET /api/v1/admin/sources
 */
async function getAdminSources(req, res) {
  try {
    const sources = await query(`
      SELECT 
        s.id, s.source_name, s.source_type, s.is_active, s.last_fetched_at, s.rate_limit_ms,
        COUNT(j.id) AS total_jobs
      FROM job_sources s
      LEFT JOIN jobs j ON s.id = j.source_id
      GROUP BY s.id, s.source_name, s.source_type, s.is_active, s.last_fetched_at, s.rate_limit_ms
    `);

    return res.status(200).json({
      success: true,
      sources
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve admin sources.'
    });
  }
}

/**
 * GET /api/v1/admin/applications
 */
async function getAdminApplications(req, res) {
  try {
    const applications = await query(`
      SELECT 
        a.id, a.user_id, a.current_status, a.applied_at, a.created_at, a.updated_at,
        j.title AS job_title, j.company AS company_name
      FROM applications a
      JOIN jobs j ON a.job_id = j.id
      ORDER BY a.updated_at DESC
    `);

    return res.status(200).json({
      success: true,
      count: applications.length,
      applications
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve admin applications.'
    });
  }
}

/**
 * GET /api/v1/admin/ingestion
 */
async function getAdminIngestion(req, res) {
  try {
    const schedulerState = {
      autoSyncEnabled: process.env.JOB_SYNC_ENABLE_AUTO === 'true',
      intervalHours: parseInt(process.env.JOB_SYNC_INTERVAL_HOURS || '1', 10)
    };

    return res.status(200).json({
      success: true,
      scheduler: schedulerState,
      adapters: [
        { sourceName: 'Greenhouse', sourceType: 'API', minDelayMs: 1000, maxRequestsPerMin: 60, status: 'ACTIVE' },
        { sourceName: 'AdzunaAPI', sourceType: 'API', minDelayMs: 2000, maxRequestsPerMin: 30, status: 'ACTIVE' },
        { sourceName: 'Lever', sourceType: 'API', minDelayMs: 1000, maxRequestsPerMin: 60, status: 'CONFIGURED' }
      ]
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve ingestion health.'
    });
  }
}

module.exports = {
  getAdminStats,
  getAdminJobs,
  getAdminSources,
  getAdminApplications,
  getAdminIngestion
};
