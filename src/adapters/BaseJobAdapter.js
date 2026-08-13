const { generateDedupHash } = require('../utils/dedupHash');

/**
 * Abstract Base Class for Job Source Adapters
 * Each adapter must inherit from BaseJobAdapter and implement fetchRawJobs & normalizeJob.
 */
class BaseJobAdapter {
  constructor(sourceName, sourceType = 'MOCK') {
    if (this.constructor === BaseJobAdapter) {
      throw new Error('Cannot instantiate abstract class BaseJobAdapter directly.');
    }
    this.sourceName = sourceName;
    this.sourceType = sourceType;
  }

  /**
   * Fetches raw unparsed job listings from the source.
   * @abstract
   */
  async fetchRawJobs(params = {}) {
    throw new Error(`fetchRawJobs() must be implemented by adapter ${this.sourceName}`);
  }

  /**
   * Normalizes a raw job payload into standardized schema format.
   * Must return an object with:
   * - externalJobId: string
   * - title: string
   * - company: string
   * - location: string
   * - isRemote: boolean
   * - employmentType: string
   * - experienceLevel: string
   * - minExperienceYears: number|null
   * - maxExperienceYears: number|null
   * - description: string
   * - jobUrl: string
   * - postedAt: string|Date|null
   * - postedAtPrecision: 'EXACT' | 'HOUR' | 'DAY' | 'UNKNOWN'
   * - requiredSkills: array of strings
   * @abstract
   */
  normalizeJob(rawJob) {
    throw new Error(`normalizeJob() must be implemented by adapter ${this.sourceName}`);
  }

  /**
   * Generates dedup hash for a normalized job.
   */
  generateDedupHash(normalizedJob) {
    return generateDedupHash(
      normalizedJob.company,
      normalizedJob.title,
      normalizedJob.location,
      normalizedJob.description
    );
  }

  /**
   * Validates normalized job payload.
   */
  validateJob(job) {
    const requiredFields = ['externalJobId', 'title', 'company', 'description', 'jobUrl'];
    for (const field of requiredFields) {
      if (!job[field]) {
        throw new Error(`Invalid job object from ${this.sourceName}: missing field '${field}'`);
      }
    }
    return true;
  }

  /**
   * Full ingestion workflow: fetch, normalize, generate hash, and validate.
   */
  async process(params = {}) {
    const rawListings = await this.fetchRawJobs(params);
    const normalizedJobs = [];

    for (const rawItem of rawListings) {
      try {
        const normalized = this.normalizeJob(rawItem);
        this.validateJob(normalized);
        normalized.dedupHash = this.generateDedupHash(normalized);
        normalized.sourceName = this.sourceName;
        normalized.sourceType = this.sourceType;
        normalizedJobs.push(normalized);
      } catch (err) {
        console.warn(`[${this.sourceName}] Skipped invalid job item: ${err.message}`);
      }
    }

    return normalizedJobs;
  }
}

module.exports = BaseJobAdapter;
