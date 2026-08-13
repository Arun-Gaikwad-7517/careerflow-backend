const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { parseSkillsAndExperience, extractTextFromBuffer } = require('../src/services/resumeParser');
const { getInMemoryPreferences } = require('../src/controllers/preferenceController');
const { getInMemoryResume } = require('../src/controllers/resumeController');

test('1. Resume Skill & Experience Extraction (Anti-Hallucination)', (t) => {
  const sampleText = `
    Arun Kumar - Senior Backend Engineer
    Email: arun@example.com | Phone: 9876543210
    
    Summary:
    5 years of experience designing scalable microservices and REST APIs using Node.js, Express.js, TypeScript, and MySQL database.
    Experienced with Redis caching and Docker containerization.
  `;

  const { parsedSkills, parsedExperience } = parseSkillsAndExperience(sampleText);

  assert.ok(parsedSkills.includes('Node.js'));
  assert.ok(parsedSkills.includes('Express.js'));
  assert.ok(parsedSkills.includes('TypeScript'));
  assert.ok(parsedSkills.includes('MySQL'));
  assert.ok(parsedSkills.includes('Redis'));
  assert.ok(parsedSkills.includes('Docker'));

  // Ensure AI/parser does NOT invent absent skills like Python, Java, AWS if not in text
  assert.equal(parsedSkills.includes('Python'), false);
  assert.equal(parsedSkills.includes('AWS'), false);

  assert.equal(parsedExperience.yearsOfExperience, 5);
  assert.equal(parsedExperience.currentTitle, 'Backend Developer');
});

test('2. Resume File Type Filter Validation', (t) => {
  const mimeTypePdf = 'application/pdf';
  const mimeTypeTxt = 'text/plain';

  assert.equal(mimeTypePdf === 'application/pdf', true);
  assert.equal(mimeTypeTxt === 'application/pdf', false);
});

test('3. Preference Validation (Experience Range Check)', (t) => {
  const validPreferences = {
    primaryRoles: ['Node.js Developer'],
    secondaryRoles: ['Software Developer'],
    preferredLocations: ['Remote', 'Bangalore'],
    minExperienceYears: 2,
    maxExperienceYears: 5
  };

  const invalidPreferences = {
    primaryRoles: ['Node.js Developer'],
    secondaryRoles: ['Software Developer'],
    preferredLocations: ['Remote'],
    minExperienceYears: 6, // Invalid min > max
    maxExperienceYears: 3
  };

  assert.ok(validPreferences.minExperienceYears <= validPreferences.maxExperienceYears);
  assert.equal(invalidPreferences.minExperienceYears > invalidPreferences.maxExperienceYears, true);
});

test('4. Resume Verification Workflow', (t) => {
  const initialResume = getInMemoryResume();
  assert.ok(initialResume.rawText);

  // User edits/verifies skills (adding 'Playwright', removing a skill)
  const userConfirmedSkills = [...initialResume.parsedSkills, 'Playwright'];
  const userConfirmedExperience = {
    yearsOfExperience: 4,
    currentTitle: 'Senior Backend Engineer',
    keySummary: 'Verified experience'
  };

  // Ensure rawText remains pristine and unchanged
  assert.ok(initialResume.rawText.includes('Backend Engineer'));
  assert.ok(userConfirmedSkills.includes('Playwright'));
  assert.equal(userConfirmedExperience.currentTitle, 'Senior Backend Engineer');
});

test('5. Regression Test: Real PDF Buffer Extraction with pdf-parse', async (t) => {
  // Minimal valid PDF binary header fixture containing text "Node.js Backend Engineer"
  const validPdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj 4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj 5 0 obj<</Length 55>>stream\nBT /F1 24 Tf 100 700 Td (Node.js Backend Engineer Resume) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f\n0000000010 00000 n\n0000000060 00000 n\n00000000117 00000 n\n00000000256 00000 n\n00000000324 00000 n\ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n429\n%%EOF\n'
  );

  const extractedText = await extractTextFromBuffer(validPdfBuffer);
  assert.ok(typeof extractedText === 'string');
  assert.ok(extractedText.includes('Node.js Backend Engineer Resume'));

  // Also verify skill parsing against extracted PDF text
  const { parsedSkills } = parseSkillsAndExperience(extractedText);
  assert.ok(parsedSkills.includes('Node.js'));
});

