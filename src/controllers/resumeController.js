const fs = require('fs');
const { extractTextFromBuffer, parseSkillsAndExperience } = require('../services/resumeParser');
const { query, testConnection } = require('../config/db');

// In-Memory Fallback State (when DB is pending configuration)
let inMemoryResume = {
  id: 1,
  userId: 1,
  title: 'Primary Resume',
  originalName: 'sample_resume.pdf',
  filePath: null,
  fileSize: 1024,
  mimeType: 'application/pdf',
  rawText: 'Backend Engineer specializing in Node.js, Express.js, MySQL, Redis, REST APIs, Microservices, and React. 4 years of experience building scalable server-side systems.',
  parsedSkills: ['Node.js', 'Express.js', 'JavaScript', 'TypeScript', 'MySQL', 'Redis', 'REST API', 'Microservices', 'React', 'Docker'],
  parsedExperience: { yearsOfExperience: 4, currentTitle: 'Backend Engineer', keySummary: '4 years of experience building server-side Node.js applications' },
  confirmedSkills: ['Node.js', 'Express.js', 'JavaScript', 'TypeScript', 'MySQL', 'Redis', 'REST API', 'Microservices', 'React', 'Docker'],
  confirmedExperience: { yearsOfExperience: 4, currentTitle: 'Backend Engineer', keySummary: '4 years of experience building server-side Node.js applications' },
  isVerified: true,
  createdAt: new Date().toISOString()
};

/**
 * GET /api/v1/resume
 */
async function getResume(req, res) {
  try {
    const dbStatus = await testConnection();
    if (dbStatus.connected) {
      const rows = await query('SELECT * FROM resumes WHERE user_id = 1 AND is_active = TRUE ORDER BY id DESC LIMIT 1');
      if (rows && rows.length > 0) {
        const r = rows[0];
        return res.status(200).json({
          success: true,
          resume: {
            id: r.id,
            userId: r.user_id,
            title: r.title,
            originalName: r.original_name,
            filePath: r.file_path,
            fileSize: r.file_size,
            mimeType: r.mime_type,
            rawText: r.raw_text,
            parsedSkills: typeof r.parsed_skills === 'string' ? JSON.parse(r.parsed_skills) : r.parsed_skills,
            parsedExperience: typeof r.parsed_experience === 'string' ? JSON.parse(r.parsed_experience) : r.parsed_experience,
            confirmedSkills: r.confirmed_skills ? (typeof r.confirmed_skills === 'string' ? JSON.parse(r.confirmed_skills) : r.confirmed_skills) : r.parsed_skills,
            confirmedExperience: r.confirmed_experience ? (typeof r.confirmed_experience === 'string' ? JSON.parse(r.confirmed_experience) : r.confirmed_experience) : r.parsed_experience,
            isVerified: Boolean(r.is_verified),
            createdAt: r.created_at
          }
        });
      }
    }

    // Fallback to in-memory resume
    res.status(200).json({
      success: true,
      resume: inMemoryResume
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch resume', details: error.message });
  }
}

/**
 * POST /api/v1/resume
 * Handles PDF file upload, text extraction, and skill parsing
 */
async function uploadResume(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Please upload a PDF resume.' });
    }

    const fileBuffer = req.file.buffer || (req.file.path ? fs.readFileSync(req.file.path) : null);
    if (!fileBuffer) {
      return res.status(400).json({ success: false, error: 'Empty file buffer received.' });
    }

    const rawText = await extractTextFromBuffer(fileBuffer);

    if (!rawText || rawText.trim().length === 0) {
      return res.status(422).json({ success: false, error: 'Could not extract text from uploaded PDF. File may be password protected or image-only scanned PDF.' });
    }

    const { parsedSkills, parsedExperience } = parseSkillsAndExperience(rawText);

    const resumeData = {
      id: Date.now(),
      userId: 1,
      title: req.file.originalname,
      originalName: req.file.originalname,
      filePath: req.file.path || null,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      rawText,
      parsedSkills,
      parsedExperience,
      confirmedSkills: parsedSkills, // Initially defaults to extracted
      confirmedExperience: parsedExperience,
      isVerified: false, // Requires user verification
      createdAt: new Date().toISOString()
    };

    // Try persisting to MySQL if database is connected
    const dbStatus = await testConnection();
    if (dbStatus.connected) {
      try {
        const sql = `
          INSERT INTO resumes (user_id, title, original_name, file_path, file_size, mime_type, raw_text, parsed_skills, parsed_experience, confirmed_skills, confirmed_experience, is_verified)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
        `;
        const params = [
          1,
          req.file.originalname,
          req.file.originalname,
          req.file.path || null,
          req.file.size,
          req.file.mimetype,
          rawText,
          JSON.stringify(parsedSkills),
          JSON.stringify(parsedExperience),
          JSON.stringify(parsedSkills),
          JSON.stringify(parsedExperience)
        ];
        await query(sql, params);
      } catch (dbErr) {
        console.warn('[DB Sync Warning] MySQL resume insertion error:', dbErr.message);
        try {
          const fallbackSql = `
            INSERT INTO resumes (user_id, title, raw_text, parsed_skills, parsed_experience, is_active)
            VALUES (?, ?, ?, ?, ?, TRUE)
          `;
          await query(fallbackSql, [
            1,
            req.file.originalname,
            rawText,
            JSON.stringify(parsedSkills),
            JSON.stringify(parsedExperience)
          ]);
        } catch (fallbackErr) {
          console.warn('[DB Fallback Warning] Resume DB persistence skipped:', fallbackErr.message);
        }
      }
    }

    // Update in-memory fallback state
    inMemoryResume = resumeData;

    res.status(201).json({
      success: true,
      message: 'Resume uploaded and parsed successfully. Please verify extracted details.',
      resume: resumeData
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Resume upload processing failed',
      details: error.message
    });
  }
}

/**
 * PUT /api/v1/resume/verify
 * Confirms or updates parsed skills & experience without altering raw_text.
 */
async function verifyResume(req, res) {
  try {
    const { confirmedSkills, confirmedExperience, isVerified } = req.body;

    if (!Array.isArray(confirmedSkills)) {
      return res.status(400).json({ success: false, error: 'confirmedSkills must be an array of string skills.' });
    }

    if (!confirmedExperience || typeof confirmedExperience !== 'object') {
      return res.status(400).json({ success: false, error: 'confirmedExperience object is required.' });
    }

    // Update in-memory state
    inMemoryResume = {
      ...inMemoryResume,
      confirmedSkills,
      confirmedExperience: {
        yearsOfExperience: parseInt(confirmedExperience.yearsOfExperience || 0, 10),
        currentTitle: confirmedExperience.currentTitle || 'Developer',
        keySummary: confirmedExperience.keySummary || ''
      },
      isVerified: isVerified !== undefined ? Boolean(isVerified) : true,
      updatedAt: new Date().toISOString()
    };

    const dbStatus = await testConnection();
    if (dbStatus.connected) {
      const sql = `
        UPDATE resumes 
        SET confirmed_skills = ?, confirmed_experience = ?, is_verified = ?
        WHERE user_id = 1 AND is_active = TRUE
      `;
      await query(sql, [
        JSON.stringify(inMemoryResume.confirmedSkills),
        JSON.stringify(inMemoryResume.confirmedExperience),
        inMemoryResume.isVerified
      ]);
    }

    res.status(200).json({
      success: true,
      message: 'Resume verification updated successfully.',
      resume: inMemoryResume
    });

  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to verify resume', details: error.message });
  }
}

module.exports = {
  getResume,
  uploadResume,
  verifyResume,
  getInMemoryResume: () => inMemoryResume
};
