const { calculateFreshness } = require('../utils/freshness');

/**
 * Job Matching and Priority Classification Service
 */
function evaluateJobMatch(job, userProfile = {}) {
  const preferences = userProfile.preferences || {
    primaryRoles: ['Node.js Developer', 'Backend Developer', 'Node.js Backend Developer'],
    secondaryRoles: ['Full Stack Developer', 'MERN Stack Developer', 'Software Developer'],
    preferredLocations: ['Remote', 'Bangalore', 'Hyderabad', 'Pune', 'Mumbai', 'Delhi NCR'],
    minExperienceYears: 2,
    maxExperienceYears: 6
  };

  const resume = userProfile.resume || {
    parsedSkills: ['Node.js', 'Express.js', 'JavaScript', 'TypeScript', 'MySQL', 'Redis', 'REST API', 'Microservices', 'React', 'Docker'],
    yearsOfExperience: 4
  };

  // 1. Skill Match Score (35%)
  const requiredSkills = job.requiredSkills || [];
  const resumeSkills = (resume.parsedSkills || []).map(s => s.toLowerCase());
  let matchedSkillsCount = 0;
  const missingSkills = [];

  requiredSkills.forEach(skill => {
    if (resumeSkills.includes(skill.toLowerCase())) {
      matchedSkillsCount++;
    } else {
      missingSkills.push(skill);
    }
  });

  const skillMatchScore = requiredSkills.length > 0
    ? parseFloat(((matchedSkillsCount / requiredSkills.length) * 100).toFixed(2))
    : 100.0;

  // 2. Role Match Score (30%)
  const titleLower = (job.title || '').toLowerCase();
  let roleMatchScore = 25.0;

  const isPrimary = preferences.primaryRoles.some(role => titleLower.includes(role.toLowerCase()));
  const isSecondary = preferences.secondaryRoles.some(role => titleLower.includes(role.toLowerCase()));

  if (isPrimary) {
    roleMatchScore = 100.0;
  } else if (isSecondary) {
    roleMatchScore = 75.0;
  } else if (titleLower.includes('backend') || titleLower.includes('node') || titleLower.includes('server')) {
    roleMatchScore = 50.0;
  }

  // 3. Experience Match Score (15%)
  const candidateExp = resume.yearsOfExperience || 4;
  const minJobExp = job.minExperienceYears ?? 0;
  const maxJobExp = job.maxExperienceYears ?? 10;
  let experienceMatchScore = 100.0;

  if (candidateExp < minJobExp) {
    const diff = minJobExp - candidateExp;
    experienceMatchScore = Math.max(0, 100.0 - (diff * 20));
  } else if (candidateExp > maxJobExp + 3) {
    experienceMatchScore = 80.0; // Slightly overqualified
  }

  // 4. Location Match Score (10%)
  let locationMatchScore = 40.0;
  const locLower = (job.location || '').toLowerCase();

  if (job.isRemote || locLower.includes('remote')) {
    locationMatchScore = 100.0;
  } else if (preferences.preferredLocations.some(loc => locLower.includes(loc.toLowerCase()))) {
    locationMatchScore = 100.0;
  }

  // 5. Freshness Score (10%)
  const freshnessInfo = calculateFreshness(job.postedAt, job.postedAtPrecision);
  const freshnessScore = freshnessInfo.freshnessScore;

  // Final Weighted Match Score Calculation (35% + 30% + 15% + 10% + 10%)
  const finalMatchScore = parseFloat((
    (skillMatchScore * 0.35) +
    (roleMatchScore * 0.30) +
    (experienceMatchScore * 0.15) +
    (locationMatchScore * 0.10) +
    (freshnessScore * 0.10)
  ).toFixed(2));

  // Priority Classification Calculation
  let priority = 'REVIEW';
  if (finalMatchScore >= 80.0 && ['VERY_FRESH', 'FRESH'].includes(freshnessInfo.category) && roleMatchScore >= 75.0) {
    priority = 'APPLY_NOW';
  } else if (finalMatchScore >= 70.0) {
    priority = 'HIGH_PRIORITY';
  } else if (finalMatchScore >= 55.0) {
    priority = 'REVIEW';
  } else if (finalMatchScore >= 40.0) {
    priority = 'LOW_PRIORITY';
  } else {
    priority = 'SKIP';
  }

  return {
    jobId: job.externalJobId,
    title: job.title,
    company: job.company,
    scores: {
      skillMatchScore,
      roleMatchScore,
      experienceMatchScore,
      locationMatchScore,
      freshnessScore,
      finalMatchScore
    },
    priority,
    freshness: freshnessInfo,
    matchedSkillsCount,
    totalSkillsCount: requiredSkills.length,
    missingSkills,
    evaluatedAt: new Date().toISOString()
  };
}

module.exports = {
  evaluateJobMatch
};
