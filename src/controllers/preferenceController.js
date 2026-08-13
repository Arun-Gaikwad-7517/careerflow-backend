const { query, testConnection } = require('../config/db');

// Default In-Memory Preferences Fallback
let inMemoryPreferences = {
  primaryRoles: ['Node.js Developer', 'Backend Developer', 'Node.js Backend Developer'],
  secondaryRoles: ['Full Stack Developer', 'MERN Stack Developer', 'Software Developer'],
  preferredLocations: ['Remote', 'Bangalore', 'Hyderabad', 'Pune', 'Mumbai', 'Delhi NCR'],
  remotePreference: true,
  minExperienceYears: 2,
  maxExperienceYears: 6,
  freshnessThresholdHours: 48,
  minApplyNowScore: 85.0,
  minHighPriorityScore: 75.0,
  minReviewScore: 60.0
};

/**
 * GET /api/v1/preferences
 */
async function getPreferences(req, res) {
  try {
    const dbStatus = await testConnection();
    if (dbStatus.connected) {
      const rows = await query('SELECT * FROM user_preferences WHERE user_id = 1 LIMIT 1');
      if (rows && rows.length > 0) {
        const p = rows[0];
        return res.status(200).json({
          success: true,
          preferences: {
            primaryRoles: typeof p.primary_roles === 'string' ? JSON.parse(p.primary_roles) : p.primary_roles,
            secondaryRoles: typeof p.secondary_roles === 'string' ? JSON.parse(p.secondary_roles) : p.secondary_roles,
            preferredLocations: typeof p.preferred_locations === 'string' ? JSON.parse(p.preferred_locations) : p.preferred_locations,
            remotePreference: Boolean(p.remote_preference),
            minExperienceYears: p.min_experience_years,
            maxExperienceYears: p.max_experience_years,
            freshnessThresholdHours: p.freshness_threshold_hours,
            minApplyNowScore: parseFloat(p.min_apply_now_score),
            minHighPriorityScore: parseFloat(p.min_high_priority_score),
            minReviewScore: parseFloat(p.min_review_score)
          }
        });
      }
    }

    res.status(200).json({
      success: true,
      preferences: inMemoryPreferences
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch preferences', details: error.message });
  }
}

/**
 * PUT /api/v1/preferences
 * Validates and updates user target roles and preferences.
 */
async function updatePreferences(req, res) {
  try {
    const {
      primaryRoles,
      secondaryRoles,
      preferredLocations,
      remotePreference,
      minExperienceYears,
      maxExperienceYears,
      freshnessThresholdHours,
      minApplyNowScore,
      minHighPriorityScore,
      minReviewScore
    } = req.body;

    // Validations
    if (!Array.isArray(primaryRoles) || primaryRoles.length === 0) {
      return res.status(400).json({ success: false, error: 'primaryRoles must be a non-empty array of role strings.' });
    }

    if (!Array.isArray(secondaryRoles)) {
      return res.status(400).json({ success: false, error: 'secondaryRoles must be an array.' });
    }

    if (!Array.isArray(preferredLocations)) {
      return res.status(400).json({ success: false, error: 'preferredLocations must be an array.' });
    }

    const minExp = parseInt(minExperienceYears, 10);
    const maxExp = parseInt(maxExperienceYears, 10);

    if (isNaN(minExp) || isNaN(maxExp) || minExp < 0 || maxExp < minExp) {
      return res.status(400).json({ success: false, error: 'Invalid experience range: minExperienceYears must be <= maxExperienceYears and non-negative.' });
    }

    const updated = {
      primaryRoles,
      secondaryRoles,
      preferredLocations,
      remotePreference: remotePreference !== undefined ? Boolean(remotePreference) : true,
      minExperienceYears: minExp,
      maxExperienceYears: maxExp,
      freshnessThresholdHours: parseInt(freshnessThresholdHours || 48, 10),
      minApplyNowScore: parseFloat(minApplyNowScore || 85.0),
      minHighPriorityScore: parseFloat(minHighPriorityScore || 75.0),
      minReviewScore: parseFloat(minReviewScore || 60.0)
    };

    inMemoryPreferences = updated;

    const dbStatus = await testConnection();
    if (dbStatus.connected) {
      const sql = `
        INSERT INTO user_preferences (
          user_id, primary_roles, secondary_roles, preferred_locations, remote_preference,
          min_experience_years, max_experience_years, freshness_threshold_hours,
          min_apply_now_score, min_high_priority_score, min_review_score
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          primary_roles = VALUES(primary_roles),
          secondary_roles = VALUES(secondary_roles),
          preferred_locations = VALUES(preferred_locations),
          remote_preference = VALUES(remote_preference),
          min_experience_years = VALUES(min_experience_years),
          max_experience_years = VALUES(max_experience_years),
          freshness_threshold_hours = VALUES(freshness_threshold_hours),
          min_apply_now_score = VALUES(min_apply_now_score),
          min_high_priority_score = VALUES(min_high_priority_score),
          min_review_score = VALUES(min_review_score)
      `;

      await query(sql, [
        1,
        JSON.stringify(primaryRoles),
        JSON.stringify(secondaryRoles),
        JSON.stringify(preferredLocations),
        updated.remotePreference,
        minExp,
        maxExp,
        updated.freshnessThresholdHours,
        updated.minApplyNowScore,
        updated.minHighPriorityScore,
        updated.minReviewScore
      ]);
    }

    res.status(200).json({
      success: true,
      message: 'User preferences updated successfully.',
      preferences: inMemoryPreferences
    });

  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update user preferences', details: error.message });
  }
}

module.exports = {
  getPreferences,
  updatePreferences,
  getInMemoryPreferences: () => inMemoryPreferences
};
