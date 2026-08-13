const BaseJobAdapter = require('../BaseJobAdapter');
const { rateLimiterInstance } = require('../../utils/rateLimiter');

class GreenhouseAdapter extends BaseJobAdapter {
  constructor() {
    super('Greenhouse', 'API');
  }

  getMonitoredCompanyTokens() {
    try {
      const rawEnv = process.env.GREENHOUSE_COMPANY_TOKENS;
      if (!rawEnv) return [];
      const parsed = typeof rawEnv === 'string' ? JSON.parse(rawEnv) : rawEnv;
      return Array.isArray(parsed) ? parsed.filter(c => c.isActive !== false && c.boardToken) : [];
    } catch (e) {
      console.warn('[GreenhouseAdapter] Error parsing GREENHOUSE_COMPANY_TOKENS:', e.message);
      return [];
    }
  }

  async fetchRawJobs(params = {}) {
    const companyTokens = this.getMonitoredCompanyTokens();
    if (companyTokens.length === 0) {
      console.warn('[GreenhouseAdapter] No active company board tokens configured in GREENHOUSE_COMPANY_TOKENS.');
      return [];
    }

    const allRawJobs = [];

    for (const companyObj of companyTokens) {
      const boardToken = companyObj.boardToken;
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;

      await rateLimiterInstance.throttle(this.sourceName);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[GreenhouseAdapter] Failed to fetch board for ${companyObj.company} (${boardToken}): HTTP ${response.status}`);
          continue;
        }
        const data = await response.json();
        if (data && Array.isArray(data.jobs)) {
          data.jobs.forEach(job => {
            job._companyName = companyObj.company; // Attach parent company context
          });
          allRawJobs.push(...data.jobs);
        }
      } catch (err) {
        console.warn(`[GreenhouseAdapter Error for ${companyObj.company}] ${err.message}`);
      }
    }

    return allRawJobs;
  }

  normalizeJob(rawJob) {
    if (!rawJob) throw new Error('Empty raw Greenhouse job item');

    // TIMESTAMP INTEGRITY RULE:
    // Uses first_published or first_published_at ONLY.
    // updated_at MUST NEVER be used as postedAt.
    let postedAt = null;
    let postedAtPrecision = 'UNKNOWN';

    const candidatePublishedDate = rawJob.first_published || rawJob.first_published_at;

    if (candidatePublishedDate) {
      const parsedDate = new Date(candidatePublishedDate);
      if (!isNaN(parsedDate.getTime())) {
        postedAt = parsedDate.toISOString();
        postedAtPrecision = 'EXACT';
      }
    }

    const company = rawJob._companyName || (rawJob.company_name ? rawJob.company_name : 'Unknown Company');
    const locationName = (rawJob.location && rawJob.location.name) ? rawJob.location.name : 'Unspecified';
    const isRemote = Boolean(
      locationName.toLowerCase().includes('remote') ||
      (rawJob.title || '').toLowerCase().includes('remote')
    );

    // Strip HTML content from description
    const descriptionText = rawJob.content ? rawJob.content.replace(/<\/?[^>]+(>|$)/g, ' ').replace(/\s+/g, ' ').trim() : '';

    return {
      externalJobId: String(rawJob.id || `gh-${Date.now()}-${Math.random()}`),
      title: rawJob.title ? rawJob.title.trim() : 'Backend Engineer',
      company: company.trim(),
      location: locationName.trim(),
      isRemote,
      employmentType: 'Full-time',
      experienceLevel: 'Not specified',
      minExperienceYears: null,
      maxExperienceYears: null,
      description: descriptionText,
      jobUrl: rawJob.absolute_url || 'https://boards.greenhouse.io',
      postedAt,
      postedAtPrecision,
      requiredSkills: []
    };
  }
}

module.exports = GreenhouseAdapter;
