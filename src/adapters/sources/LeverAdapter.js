const BaseJobAdapter = require('../BaseJobAdapter');
const { rateLimiterInstance } = require('../../utils/rateLimiter');

class LeverAdapter extends BaseJobAdapter {
  constructor() {
    super('Lever', 'API');
  }

  getMonitoredCompanyTokens() {
    try {
      const rawEnv = process.env.LEVER_COMPANY_TOKENS;
      if (!rawEnv) return [];
      const parsed = typeof rawEnv === 'string' ? JSON.parse(rawEnv) : rawEnv;
      return Array.isArray(parsed) ? parsed.filter(c => c.isActive !== false && c.boardToken) : [];
    } catch (e) {
      console.warn('[LeverAdapter] Error parsing LEVER_COMPANY_TOKENS:', e.message);
      return [];
    }
  }

  async fetchRawJobs(params = {}) {
    const companyTokens = this.getMonitoredCompanyTokens();
    if (companyTokens.length === 0) {
      console.warn('[LeverAdapter] No active company board tokens configured in LEVER_COMPANY_TOKENS.');
      return [];
    }

    const allRawJobs = [];

    for (const companyObj of companyTokens) {
      const boardToken = companyObj.boardToken;
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken)}?mode=json`;

      await rateLimiterInstance.throttle(this.sourceName);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[LeverAdapter] Failed to fetch postings for ${companyObj.company} (${boardToken}): HTTP ${response.status}`);
          continue;
        }
        const data = await response.json();
        if (Array.isArray(data)) {
          data.forEach(job => {
            job._companyName = companyObj.company; // Attach parent company context
          });
          allRawJobs.push(...data);
        }
      } catch (err) {
        console.warn(`[LeverAdapter Error for ${companyObj.company}] ${err.message}`);
      }
    }

    return allRawJobs;
  }

  normalizeJob(rawJob) {
    if (!rawJob) throw new Error('Empty raw Lever job item');

    // TIMESTAMP INTEGRITY RULE:
    // Uses createdAt ONLY.
    // updatedAt MUST NEVER be used as postedAt.
    let postedAt = null;
    let postedAtPrecision = 'UNKNOWN';

    if (rawJob.createdAt) {
      const parsedDate = new Date(typeof rawJob.createdAt === 'number' ? rawJob.createdAt : rawJob.createdAt);
      if (!isNaN(parsedDate.getTime())) {
        postedAt = parsedDate.toISOString();
        postedAtPrecision = 'EXACT';
      }
    }

    const company = rawJob._companyName || 'Unknown Company';
    const categories = rawJob.categories || {};
    const locationName = categories.location || 'Unspecified';
    const isRemote = Boolean(
      locationName.toLowerCase().includes('remote') ||
      (rawJob.text || '').toLowerCase().includes('remote')
    );

    // Description Plaintext
    const descriptionText = rawJob.descriptionPlain ||
      (rawJob.description ? rawJob.description.replace(/<\/?[^>]+(>|$)/g, ' ').replace(/\s+/g, ' ').trim() : '');

    return {
      externalJobId: String(rawJob.id || `lever-${Date.now()}-${Math.random()}`),
      title: rawJob.text ? rawJob.text.trim() : 'Software Engineer',
      company: company.trim(),
      location: locationName.trim(),
      isRemote,
      employmentType: categories.commitment || 'Full-time',
      experienceLevel: 'Not specified',
      minExperienceYears: null,
      maxExperienceYears: null,
      description: descriptionText,
      jobUrl: rawJob.hostedUrl || rawJob.applyUrl || 'https://jobs.lever.co',
      postedAt,
      postedAtPrecision,
      requiredSkills: []
    };
  }
}

module.exports = LeverAdapter;
