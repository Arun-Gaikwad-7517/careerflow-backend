/**
 * Adapter Registry
 * Manages registration, discovery, and execution of JobSourceAdapters.
 */
class AdapterRegistry {
  constructor() {
    this.adapters = new Map();
  }

  /**
   * Registers a job adapter instance.
   */
  register(adapter) {
    if (!adapter || !adapter.sourceName) {
      throw new Error('Invalid adapter: Must have a sourceName property.');
    }
    this.adapters.set(adapter.sourceName.toLowerCase(), adapter);
  }

  /**
   * Retrieves an adapter by source name.
   */
  get(sourceName) {
    return this.adapters.get(sourceName.toLowerCase());
  }

  /**
   * Returns array of registered adapter names.
   */
  list() {
    return Array.from(this.adapters.values()).map(adapter => ({
      sourceName: adapter.sourceName,
      sourceType: adapter.sourceType
    }));
  }

  /**
   * Executes fetch and normalization across all registered adapters or specified active adapters.
   */
  async processAll(params = {}) {
    const results = [];
    for (const [name, adapter] of this.adapters.entries()) {
      try {
        const jobs = await adapter.process(params);
        results.push({ sourceName: adapter.sourceName, count: jobs.length, jobs, status: 'SUCCESS' });
      } catch (error) {
        results.push({ sourceName: adapter.sourceName, count: 0, jobs: [], status: 'FAILED', error: error.message });
      }
    }
    return results;
  }
}

// Singleton registry instance
const registryInstance = new AdapterRegistry();

module.exports = {
  AdapterRegistry,
  registryInstance
};
