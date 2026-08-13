const BaseJobAdapter = require('../BaseJobAdapter');
const { rateLimiterInstance } = require('../../utils/rateLimiter');

class AdzunaApiAdapter extends BaseJobAdapter {
  constructor() {
    super('AdzunaAPI', 'API');
    this.defaultQueries = [
      'Node.js Developer',
      'Node.js Backend Developer',
      'MERN Stack Developer',
      'Backend Developer',
      'Full Stack Developer'
    ];
  }

  async fetchRawJobs(params = {}) {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    const country = process.env.ADZUNA_COUNTRY || 'in';

    if (!appId || !appKey) {
      console.warn('[AdzunaAPI] API Credentials missing in environment variables. Set ADZUNA_APP_ID and ADZUNA_APP_KEY in server/.env');
      return [];
    }

    const targetQueries = params.query ? [params.query] : this.defaultQueries;
    const page = params.page || 1;
    const resultsPerPage = params.resultsPerPage || 20;
    const allRawResults = [];

    for (const q of targetQueries) {
      await rateLimiterInstance.throttle(this.sourceName);

      const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}&results_per_page=${resultsPerPage}&what=${encodeURIComponent(q)}&sort_by=date`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`[AdzunaAPI Error for query "${q}"]: HTTP ${response.status} ${response.statusText}`);
          continue;
        }
        const data = await response.json();
        if (data && Array.isArray(data.results)) {
          allRawResults.push(...data.results);
        }
      } catch (error) {
        let safeMsg = error.message;
        if (appId) safeMsg = safeMsg.replaceAll(appId, '[REDACTED]');
        if (appKey) safeMsg = safeMsg.replaceAll(appKey, '[REDACTED]');
        console.error(`[AdzunaAPI Fetch Error for query "${q}"]:`, safeMsg);
      }
    }

    return allRawResults;
  }

  normalizeJob(rawJob) {
    if (!rawJob) throw new Error('Empty raw job item');

    // Timestamp Handling: Adzuna provides 'created' as ISO string e.g. "2026-08-11T12:00:00Z"
    let postedAt = null;
    let postedAtPrecision = 'UNKNOWN';

    if (rawJob.created) {
      const parsedDate = new Date(rawJob.created);
      if (!isNaN(parsedDate.getTime())) {
        postedAt = parsedDate.toISOString();
        postedAtPrecision = 'EXACT';
      }
    }

    // Company & Location Extraction
    const company = (rawJob.company && rawJob.company.display_name) ? rawJob.company.display_name : 'Unknown Company';
    const locationName = (rawJob.location && rawJob.location.display_name) ? rawJob.location.display_name : 'Remote / Unspecified';
    const isRemote = Boolean(
      locationName.toLowerCase().includes('remote') ||
      (rawJob.title || '').toLowerCase().includes('remote')
    );

    return {
      externalJobId: String(rawJob.id || `adzuna-${Date.now()}-${Math.random()}`),
      title: rawJob.title ? rawJob.title.replace(/<\/?[^>]+(>|$)/g, '').trim() : 'Software Developer',
      company: company.trim(),
      location: locationName.trim(),
      isRemote,
      employmentType: rawJob.contract_time === 'full_time' ? 'Full-time' : 'Contract',
      experienceLevel: 'Not specified',
      minExperienceYears: null,
      maxExperienceYears: null,
      description: rawJob.description ? rawJob.description.replace(/<\/?[^>]+(>|$)/g, '').trim() : '',
      jobUrl: rawJob.redirect_url || 'https://www.adzuna.com',
      postedAt,
      postedAtPrecision,
      requiredSkills: []
    };
  }
}

module.exports = AdzunaApiAdapter;
