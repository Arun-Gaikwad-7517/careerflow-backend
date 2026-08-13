const express = require('express');
const router = express.Router();
const { testConnection } = require('../config/db');
const { registryInstance } = require('../adapters/AdapterRegistry');
const { evaluateJobMatch } = require('../services/matchingService');
const { upload } = require('../middleware/uploadMiddleware');
const { getResume, uploadResume, verifyResume } = require('../controllers/resumeController');
const { getPreferences, updatePreferences } = require('../controllers/preferenceController');
const { ingestJobsFromSources } = require('../services/jobIngestionService');
const { getSchedulerStatus } = require('../services/schedulerService');
const { rateLimiterInstance } = require('../utils/rateLimiter');
const { getJobs } = require('../controllers/jobController');
const {
  prepareApplication,
  getApplications,
  getApplicationById,
  updateApplicationStatus
} = require('../controllers/applicationController');

const { login, logout, me } = require('../controllers/authController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const {
  getAdminStats,
  getAdminJobs,
  getAdminSources,
  getAdminApplications,
  getAdminIngestion
} = require('../controllers/adminController');

const {
  getNotifications,
  markSingleRead,
  markAllRead
} = require('../controllers/notificationController');

/**
 * GET /api/v1/health
 * Health check endpoint showing backend status and MySQL readiness.
 */
router.get('/health', async (req, res) => {
  const dbStatus = await testConnection();
  
  res.status(200).json({
    status: 'ONLINE',
    service: 'Job Application Assistant API',
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: dbStatus,
    scheduler: getSchedulerStatus()
  });
});

// Authentication Endpoints
router.post('/auth/login', login);
router.post('/auth/logout', logout);
router.get('/auth/me', authenticateToken, me);

// Admin Protected Endpoints (Requires valid session + ADMIN role)
router.get('/admin/stats', authenticateToken, requireAdmin, getAdminStats);
router.get('/admin/jobs', authenticateToken, requireAdmin, getAdminJobs);
router.get('/admin/sources', authenticateToken, requireAdmin, getAdminSources);
router.get('/admin/applications', authenticateToken, requireAdmin, getAdminApplications);
router.get('/admin/ingestion', authenticateToken, requireAdmin, getAdminIngestion);

// Candidate Job Notification Endpoints (Phase 5)
router.get('/notifications', getNotifications);
router.put('/notifications/:id/read', markSingleRead);
router.put('/notifications/read-all', markAllRead);

// Candidate Resume Endpoints
router.get('/resume', getResume);
router.post('/resume', upload.single('resume'), uploadResume);
router.put('/resume/verify', verifyResume);

// Preferences Endpoints
router.get('/preferences', getPreferences);
router.put('/preferences', updatePreferences);

// Application Preparation & Kanban Tracking Endpoints
router.post('/applications/prepare', prepareApplication);
router.get('/applications', getApplications);
router.get('/applications/:id', getApplicationById);
router.put('/applications/:id/status', updateApplicationStatus);

// Jobs Radar Endpoints (MySQL Real Jobs)
router.get('/jobs', getJobs);

/**
 * GET /api/v1/adapters
 * Lists registered job source adapters and rate limit settings.
 */
router.get('/adapters', (req, res) => {
  const adapterList = registryInstance.list().map(a => ({
    ...a,
    rateLimitConfig: rateLimiterInstance.getRateLimitConfig(a.sourceName)
  }));

  res.status(200).json({
    success: true,
    adapters: adapterList,
    scheduler: getSchedulerStatus()
  });
});

/**
 * Middleware: verifyCronSecret
 * Validates Authorization header against process.env.CRON_SECRET for Vercel Cron jobs.
 */
function verifyCronSecret(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({
      success: false,
      error: 'CRON_SECRET environment variable is not configured.'
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing Cron Secret authorization header.'
    });
  }

  next();
}

/**
 * GET /api/v1/cron/jobs-sync
 * Dedicated automated Vercel Cron ingestion endpoint.
 * Protected: Requires Authorization: Bearer <CRON_SECRET> header.
 */
router.get('/cron/jobs-sync', verifyCronSecret, async (req, res) => {
  try {
    const results = await ingestJobsFromSources();
    res.status(200).json({
      success: true,
      message: 'Automated Vercel cron job ingestion completed successfully.',
      summary: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Cron job ingestion sync failed',
      details: error.message
    });
  }
});

/**
 * POST /api/v1/jobs/sync
 * Triggers Phase 3 job ingestion across registered job source adapters.
 * Protected: Admin authentication required.
 */
router.post('/jobs/sync', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const syncOptions = req.body || {};
    const results = await ingestJobsFromSources(syncOptions);

    res.status(200).json({
      success: true,
      message: `Job ingestion completed. Fetched: ${results.totalFetched}, Ingested: ${results.totalUniqueIngested}, Duplicates Skipped: ${results.totalDuplicatesSkipped}`,
      summary: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Job ingestion sync failed',
      details: error.message
    });
  }
});

module.exports = router;
