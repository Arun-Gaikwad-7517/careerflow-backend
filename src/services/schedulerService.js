const { ingestJobsFromSources } = require('./jobIngestionService');
require('dotenv').config();

let timerHandle = null;
let lastExecutionTime = null;
let isRunning = false;

/**
 * Gets configured sync interval in milliseconds.
 * Default: 1 Hour (3,600,000 ms)
 */
function getSyncIntervalMs() {
  const intervalHours = parseFloat(process.env.JOB_SYNC_INTERVAL_HOURS || '1');
  const validHours = (!isNaN(intervalHours) && intervalHours > 0) ? intervalHours : 1;
  return Math.round(validHours * 60 * 60 * 1000);
}

/**
 * Starts background sync scheduler
 */
function startScheduler() {
  if (timerHandle) {
    console.log('[Scheduler] Background job sync scheduler is already active.');
    return;
  }

  const intervalMs = getSyncIntervalMs();
  const intervalHours = (intervalMs / (1000 * 60 * 60)).toFixed(1);

  console.log(`[Scheduler] Starting background job sync scheduler. Interval: ${intervalHours} hour(s) (${intervalMs} ms)`);

  isRunning = true;

  timerHandle = setInterval(async () => {
    console.log(`[Scheduler Trigger] Running scheduled 48h job sync at ${new Date().toISOString()}...`);
    try {
      lastExecutionTime = new Date().toISOString();
      await ingestJobsFromSources();
      console.log(`[Scheduler Trigger] Scheduled job sync completed.`);
    } catch (err) {
      console.error(`[Scheduler Error] Job sync failed:`, err.message);
    }
  }, intervalMs);
}

/**
 * Stops background sync scheduler
 */
function stopScheduler() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
    isRunning = false;
    console.log('[Scheduler] Background job sync scheduler stopped.');
  }
}

/**
 * Returns current scheduler status
 */
function getSchedulerStatus() {
  const intervalMs = getSyncIntervalMs();
  return {
    isRunning,
    intervalHours: parseFloat((intervalMs / (1000 * 60 * 60)).toFixed(2)),
    intervalMs,
    autoEnabled: process.env.JOB_SYNC_ENABLE_AUTO === 'true',
    lastExecutionTime
  };
}

module.exports = {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  getSyncIntervalMs
};
