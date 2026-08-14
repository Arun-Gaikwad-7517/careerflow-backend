// Master Skill Keywords for Deterministic Parsing
const KNOWN_SKILLS = [
  'Node.js', 'Express.js', 'JavaScript', 'TypeScript', 'REST API',
  'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'React', 'HTML/CSS',
  'Tailwind CSS', 'Docker', 'AWS', 'Jest', 'Playwright', 'Microservices',
  'GraphQL', 'Git', 'Linux', 'Python', 'Java', 'C++', 'K8s', 'Kubernetes'
];

/**
 * Deterministic PDF text extractor
 * Lazy-loads pdf-parse inside execution context for serverless compatibility.
 */
async function extractTextFromBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty file buffer provided for text extraction');
  }
  try {
    const pdfParseModule = require('pdf-parse');
    if (typeof pdfParseModule === 'function') {
      const parsedData = await pdfParseModule(buffer);
      return parsedData && parsedData.text ? parsedData.text.trim() : '';
    } else if (pdfParseModule && typeof pdfParseModule.PDFParse === 'function') {
      const parserInstance = new pdfParseModule.PDFParse({ data: buffer });
      const result = await parserInstance.getText();
      const rawText = result && typeof result.text === 'string' ? result.text : '';
      return rawText.trim();
    } else {
      throw new Error('Unsupported pdf-parse module export structure');
    }
  } catch (error) {
    throw new Error(`PDF Text Extraction Failed: ${error.message}`);
  }
}

/**
 * Deterministic Skill & Experience Parser
 * Enforces strict anti-hallucination rules by only extracting terms present in raw text.
 */
function parseSkillsAndExperience(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      parsedSkills: [],
      parsedExperience: { yearsOfExperience: 0, currentTitle: 'Developer', keySummary: '' }
    };
  }

  const textLower = rawText.toLowerCase();

  // 1. Skill Extraction
  const extractedSkills = KNOWN_SKILLS.filter(skill => {
    const target = skill.toLowerCase();
    // Use word boundary check or inclusion check
    if (target.includes('.')) {
      return textLower.includes(target);
    }
    const regex = new RegExp(`\\b${target.replace('+', '\\+')}\\b`, 'i');
    return regex.test(textLower);
  });

  // 2. Experience Extraction via Regex Patterns
  let yearsOfExperience = 0;
  const expMatch = rawText.match(/(\d+)\+?\s*(?:years?|yrs?)\b(?:\s+of)?\s+(?:experience|exp)\b/i) ||
                   rawText.match(/(?:experience|exp):\s*(\d+)\+?\s*(?:years?|yrs?)/i);

  if (expMatch && expMatch[1]) {
    yearsOfExperience = parseInt(expMatch[1], 10);
  }

  // 3. Current Title Detection Snippet
  let currentTitle = 'Backend Engineer';
  if (textLower.includes('node.js developer') || textLower.includes('nodejs developer')) {
    currentTitle = 'Node.js Developer';
  } else if (textLower.includes('full stack') || textLower.includes('fullstack')) {
    currentTitle = 'Full Stack Developer';
  } else if (textLower.includes('backend developer') || textLower.includes('backend engineer')) {
    currentTitle = 'Backend Developer';
  } else if (textLower.includes('software developer') || textLower.includes('software engineer')) {
    currentTitle = 'Software Developer';
  }

  return {
    parsedSkills: extractedSkills,
    parsedExperience: {
      yearsOfExperience,
      currentTitle,
      keySummary: rawText.slice(0, 300).trim() + (rawText.length > 300 ? '...' : '')
    }
  };
}

module.exports = {
  extractTextFromBuffer,
  parseSkillsAndExperience,
  KNOWN_SKILLS
};
