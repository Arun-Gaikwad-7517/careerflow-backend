/**
 * 48-Hour Job Freshness Calculator
 * 
 * Rules:
 * - EXACT / HOUR / DAY: Calculates hours difference relative to current reference time.
 * - <= 24 hours: VERY_FRESH (Score 100.0)
 * - > 24 and <= 48 hours: FRESH (Score 75.0)
 * - > 48 hours: NOT_FRESH (Score 25.0)
 * - UNKNOWN: posted_at is NULL. Category is strictly UNKNOWN.
 *   Discovered_at is NEVER used as a fallback to claim a job is fresh.
 */

function calculateFreshness(postedAt, postedAtPrecision = 'UNKNOWN', referenceTime = new Date()) {
  const refDate = new Date(referenceTime);

  // Requirement: UNKNOWN posting time or missing postedAt date
  if (postedAtPrecision === 'UNKNOWN' || !postedAt) {
    return {
      category: 'UNKNOWN',
      displayLabel: 'Posting date unavailable',
      freshnessScore: 0.0,
      ageInHours: null,
      precision: 'UNKNOWN'
    };
  }

  const postDate = new Date(postedAt);
  if (isNaN(postDate.getTime())) {
    return {
      category: 'UNKNOWN',
      displayLabel: 'Posting date unavailable',
      freshnessScore: 0.0,
      ageInHours: null,
      precision: 'UNKNOWN'
    };
  }

  // Calculate age in hours
  const diffMs = refDate.getTime() - postDate.getTime();
  const ageInHours = Math.max(0, diffMs / (1000 * 60 * 60));

  let category = 'NOT_FRESH';
  let freshnessScore = 25.0;
  let displayLabel = '';

  if (ageInHours <= 24) {
    category = 'VERY_FRESH';
    freshnessScore = 100.0;
    const roundedHours = Math.round(ageInHours);
    displayLabel = roundedHours <= 1 ? 'Posted < 1h ago' : `Posted ${roundedHours}h ago`;
  } else if (ageInHours <= 48) {
    category = 'FRESH';
    freshnessScore = 75.0;
    const roundedHours = Math.round(ageInHours);
    displayLabel = `Posted ${roundedHours}h ago`;
  } else {
    category = 'NOT_FRESH';
    freshnessScore = 25.0;
    const daysAgo = Math.floor(ageInHours / 24);
    displayLabel = `Posted ${daysAgo}d ago`;
  }

  return {
    category,
    displayLabel,
    freshnessScore,
    ageInHours: parseFloat(ageInHours.toFixed(1)),
    precision: postedAtPrecision
  };
}

module.exports = {
  calculateFreshness
};
