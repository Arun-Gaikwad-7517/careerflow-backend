const { query, testConnection } = require('../config/db');

// State Machine Valid Transitions Matrix (No READY_FOR_REVIEW)
const VALID_TRANSITIONS = {
  DRAFT: ['APPLIED', 'WITHDRAWN'],
  APPLIED: ['INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  INTERVIEWING: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['REJECTED', 'WITHDRAWN'],
  REJECTED: ['INTERVIEWING', 'WITHDRAWN'],
  WITHDRAWN: ['DRAFT', 'APPLIED']
};

/**
 * POST /api/v1/applications/prepare
 * Saves/prepares a job application record as DRAFT without cover letter generation.
 */
async function prepareApplication(req, res) {
  try {
    const { jobId } = req.body;
    const userId = (req.user && (req.user.id || req.user.userId)) || 1;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'jobId is required to prepare an application.'
      });
    }

    const dbStatus = await testConnection();
    if (!dbStatus.connected) {
      return res.status(530).json({
        success: false,
        error: 'Database service unavailable.'
      });
    }

    // 1. Verify job exists
    const jobRows = await query('SELECT * FROM jobs WHERE id = ? LIMIT 1', [jobId]);
    if (!jobRows || jobRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Specified job ID was not found.'
      });
    }
    const targetJob = jobRows[0];

    // 2. Check if application already exists for (userId, jobId)
    const existingAppRows = await query(
      'SELECT * FROM applications WHERE user_id = ? AND job_id = ? LIMIT 1',
      [userId, jobId]
    );

    let appId;
    let currentStatus = 'DRAFT';

    if (existingAppRows && existingAppRows.length > 0) {
      appId = existingAppRows[0].id;
      currentStatus = existingAppRows[0].current_status;
    } else {
      // 3. Create new application record in DRAFT status
      const insertResult = await query(
        'INSERT INTO applications (user_id, job_id, resume_id, current_status, notes) VALUES (?, ?, 1, "DRAFT", "")',
        [userId, jobId]
      );
      appId = insertResult.insertId;

      // Log initialization in audit history
      await query(
        'INSERT INTO application_status_history (application_id, previous_status, new_status, notes) VALUES (?, NULL, "DRAFT", "Application saved to candidate tracking pipeline.")',
        [appId]
      );
    }

    // Fetch full application record with joined job and match data
    const fullApp = await fetchApplicationFullDetails(appId);

    return res.status(201).json({
      success: true,
      message: 'Application saved successfully.',
      application: fullApp
    });

  } catch (err) {
    console.error('Error preparing application:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to prepare job application.'
    });
  }
}

/**
 * GET /api/v1/applications
 * Returns candidate application tracking list with joined job & match details.
 */
async function getApplications(req, res) {
  try {
    const userId = (req.user && (req.user.id || req.user.userId)) || 1;
    const { status } = req.query;

    let sql = `
      SELECT 
        a.id, a.user_id, a.job_id, a.resume_id, a.current_status AS status,
        a.notes, a.applied_at AS appliedAt, a.created_at AS createdAt, a.updated_at AS updatedAt,
        j.title AS job_title, j.company, j.location, j.job_url, j.posted_at, j.posted_at_precision,
        s.source_name,
        m.final_match_score, m.priority
      FROM applications a
      JOIN jobs j ON a.job_id = j.id
      JOIN job_sources s ON j.source_id = s.id
      LEFT JOIN job_matches m ON (m.job_id = j.id AND m.user_id = a.user_id)
      WHERE a.user_id = ?
    `;

    const params = [userId];

    if (status) {
      sql += ' AND a.current_status = ?';
      params.push(status);
    }

    sql += ' ORDER BY a.updated_at DESC';

    const rows = await query(sql, params);

    const formattedApps = rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      jobId: r.job_id,
      status: r.status,
      notes: r.notes,
      appliedAt: r.appliedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      job: {
        id: r.job_id,
        title: r.job_title,
        company: r.company,
        location: r.location,
        jobUrl: r.job_url,
        postedAt: r.posted_at,
        sourceName: r.source_name
      },
      match: {
        finalMatchScore: r.final_match_score ? parseFloat(r.final_match_score) : 75.0,
        priority: r.priority || 'REVIEW'
      }
    }));

    return res.status(200).json({
      success: true,
      count: formattedApps.length,
      applications: formattedApps
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve application list.'
    });
  }
}

/**
 * GET /api/v1/applications/:id
 */
async function getApplicationById(req, res) {
  try {
    const appId = parseInt(req.params.id, 10);
    if (isNaN(appId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID.' });
    }

    const fullApp = await fetchApplicationFullDetails(appId);
    if (!fullApp) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    return res.status(200).json({
      success: true,
      application: fullApp
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to retrieve application details.' });
  }
}

/**
 * PUT /api/v1/applications/:id/status
 * Manually updates application state transition (DRAFT -> APPLIED -> INTERVIEWING -> OFFER / REJECTED)
 */
async function updateApplicationStatus(req, res) {
  try {
    const appId = parseInt(req.params.id, 10);
    const { status: targetStatus, notes } = req.body;

    if (isNaN(appId) || !targetStatus) {
      return res.status(400).json({ success: false, error: 'Invalid application ID or target status.' });
    }

    const appRows = await query('SELECT * FROM applications WHERE id = ? LIMIT 1', [appId]);
    if (!appRows || appRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Application record not found.' });
    }

    const currentApp = appRows[0];
    const currentStatus = currentApp.current_status;

    // Validate state machine transition matrix
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(targetStatus) && targetStatus !== currentStatus) {
      return res.status(422).json({
        success: false,
        error: `Invalid status transition from ${currentStatus} to ${targetStatus}.`,
        allowedTransitions: allowed
      });
    }

    let appliedAt = currentApp.applied_at;
    if (targetStatus === 'APPLIED' && !appliedAt) {
      appliedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }

    const updateSql = `
      UPDATE applications 
      SET current_status = ?, notes = COALESCE(?, notes), applied_at = ?
      WHERE id = ?
    `;

    await query(updateSql, [targetStatus, notes || null, appliedAt, appId]);

    // Insert history log
    await query(
      'INSERT INTO application_status_history (application_id, previous_status, new_status, notes) VALUES (?, ?, ?, ?)',
      [appId, currentStatus, targetStatus, notes || `Status updated to ${targetStatus}`]
    );

    const updatedApp = await fetchApplicationFullDetails(appId);

    return res.status(200).json({
      success: true,
      message: `Status successfully updated to ${targetStatus}.`,
      application: updatedApp
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update application status.' });
  }
}

/**
 * Helper to fetch application full details with job, match, and history
 */
async function fetchApplicationFullDetails(appId) {
  const sql = `
    SELECT 
      a.id, a.user_id, a.job_id, a.resume_id, a.current_status AS status,
      a.notes, a.applied_at AS appliedAt, a.created_at AS createdAt, a.updated_at AS updatedAt,
      j.title AS job_title, j.company, j.location, j.job_url, j.posted_at,
      s.source_name,
      m.final_match_score, m.priority
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    JOIN job_sources s ON j.source_id = s.id
    LEFT JOIN job_matches m ON (m.job_id = j.id AND m.user_id = a.user_id)
    WHERE a.id = ?
    LIMIT 1;
  `;

  const rows = await query(sql, [appId]);
  if (!rows || rows.length === 0) return null;

  const r = rows[0];

  const historyRows = await query(
    'SELECT id, previous_status, new_status, notes, changed_at FROM application_status_history WHERE application_id = ? ORDER BY changed_at DESC',
    [appId]
  );

  return {
    id: r.id,
    userId: r.user_id,
    jobId: r.job_id,
    status: r.status,
    notes: r.notes,
    appliedAt: r.appliedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    job: {
      id: r.job_id,
      title: r.job_title,
      company: r.company,
      location: r.location,
      jobUrl: r.job_url,
      postedAt: r.posted_at,
      sourceName: r.source_name
    },
    match: {
      finalMatchScore: r.final_match_score ? parseFloat(r.final_match_score) : 75.0,
      priority: r.priority || 'REVIEW'
    },
    history: historyRows || []
  };
}

module.exports = {
  prepareApplication,
  getApplications,
  getApplicationById,
  updateApplicationStatus,
  VALID_TRANSITIONS
};
