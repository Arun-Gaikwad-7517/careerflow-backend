const BaseJobAdapter = require('../BaseJobAdapter');

class MockJobAdapter extends BaseJobAdapter {
  constructor() {
    super('MockSource', 'MOCK');
  }

  async fetchRawJobs(params = {}) {
    const now = new Date();

    // Calculate dates for test mock data
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const eighteenHoursAgo = new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString();
    const thirtySixHoursAgo = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
    const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();

    return [
      {
        id: 'MOCK-001',
        job_title: 'Senior Node.js Backend Developer',
        company_name: 'TechScale Innovations',
        job_location: 'Remote',
        remote_flag: true,
        type: 'Full-time',
        exp_range: '3-6 years',
        min_years: 3,
        max_years: 6,
        job_description: 'We are looking for a Senior Node.js Developer to architect backend microservices, design REST APIs, and optimize MySQL queries. Experience with Express.js, Redis, and MySQL required.',
        link: 'https://example.com/jobs/mock-001',
        posted_date: twoHoursAgo,
        date_precision: 'EXACT',
        skills_required: ['Node.js', 'Express.js', 'MySQL', 'Redis', 'REST API', 'Microservices']
      },
      {
        id: 'MOCK-002',
        job_title: 'Backend Developer (Node.js / Express)',
        company_name: 'CloudCore Systems',
        job_location: 'Bangalore, India',
        remote_flag: false,
        type: 'Full-time',
        exp_range: '2-4 years',
        min_years: 2,
        max_years: 4,
        job_description: 'Fast-growing SaaS startup hiring a Backend Developer with strong skills in Node.js, Express.js, JavaScript, and MySQL database management.',
        link: 'https://example.com/jobs/mock-002',
        posted_date: eighteenHoursAgo,
        date_precision: 'HOUR',
        skills_required: ['Node.js', 'Express.js', 'JavaScript', 'MySQL', 'REST API']
      },
      {
        id: 'MOCK-003',
        job_title: 'Full Stack Developer (Node.js & React)',
        company_name: 'Apex Digital Labs',
        job_location: 'Hyderabad, India',
        remote_flag: true,
        type: 'Full-time',
        exp_range: '3-5 years',
        min_years: 3,
        max_years: 5,
        job_description: 'Seeking a Full Stack Engineer proficient in Node.js, Express.js, MySQL, and React frontend framework.',
        link: 'https://example.com/jobs/mock-003',
        posted_date: thirtySixHoursAgo,
        date_precision: 'DAY',
        skills_required: ['Node.js', 'React', 'JavaScript', 'MySQL', 'Express.js']
      },
      {
        id: 'MOCK-004',
        job_title: 'Node.js Backend Developer',
        company_name: 'FinTech Pulse',
        job_location: 'Pune, India',
        remote_flag: false,
        type: 'Contract',
        exp_range: '4-7 years',
        min_years: 4,
        max_years: 7,
        job_description: 'Build robust payment processing pipelines using Node.js, Redis, MySQL, and Docker.',
        link: 'https://example.com/jobs/mock-004',
        posted_date: seventyTwoHoursAgo,
        date_precision: 'EXACT',
        skills_required: ['Node.js', 'MySQL', 'Redis', 'Docker', 'REST API']
      },
      {
        id: 'MOCK-005',
        job_title: 'Software Developer - Backend Focus',
        company_name: 'Nexus NextGen Enterprise',
        job_location: 'Mumbai, India',
        remote_flag: true,
        type: 'Full-time',
        exp_range: '2-5 years',
        min_years: 2,
        max_years: 5,
        job_description: 'Looking for a Software Developer with experience in server-side JavaScript/TypeScript, Express, and Relational databases.',
        link: 'https://example.com/jobs/mock-005',
        posted_date: null, // Unknown timestamp
        date_precision: 'UNKNOWN',
        skills_required: ['JavaScript', 'TypeScript', 'Node.js', 'MySQL']
      }
    ];
  }

  normalizeJob(rawJob) {
    return {
      externalJobId: rawJob.id,
      title: rawJob.job_title,
      company: rawJob.company_name,
      location: rawJob.job_location,
      isRemote: Boolean(rawJob.remote_flag),
      employmentType: rawJob.type || 'Full-time',
      experienceLevel: rawJob.exp_range,
      minExperienceYears: rawJob.min_years || null,
      maxExperienceYears: rawJob.max_years || null,
      description: rawJob.job_description,
      jobUrl: rawJob.link,
      postedAt: rawJob.posted_date || null,
      postedAtPrecision: rawJob.date_precision || 'UNKNOWN',
      requiredSkills: rawJob.skills_required || []
    };
  }
}

module.exports = MockJobAdapter;
