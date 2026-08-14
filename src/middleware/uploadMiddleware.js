const multer = require('multer');
const path = require('path');

// Memory Storage Configuration (Cloud & Serverless Compatible)
const storage = multer.memoryStorage();

// Strict MIME Type & Extension Filter
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (file.mimetype === 'application/pdf' && ext === '.pdf') {
    cb(null, true);
  } else {
    cb(new Error('INVALID_FILE_TYPE: Only PDF files (.pdf) are permitted.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB Limit
  }
});

module.exports = {
  upload
};
