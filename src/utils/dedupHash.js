const crypto = require('crypto');

/**
 * Normalizes text by converting to lowercase, stripping non-alphanumeric characters (except spaces),
 * and collapsing multiple whitespace into a single space.
 */
function normalizeString(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // remove special characters
    .replace(/\s+/g, ' ')        // collapse whitespace
    .trim();
}

/**
 * Generates a SHA-256 dedup hash from normalized company, title, location, and description.
 */
function generateDedupHash(company, title, location, description) {
  const normCompany = normalizeString(company);
  const normTitle = normalizeString(title);
  const normLocation = normalizeString(location);
  const normDescription = normalizeString(description);

  const combinedString = `${normCompany}|${normTitle}|${normLocation}|${normDescription}`;
  return crypto.createHash('sha256').update(combinedString).digest('hex');
}

module.exports = {
  normalizeString,
  generateDedupHash
};
