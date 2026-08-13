const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 5000;

// Basic Middleware
app.use(cors({
  origin: process.env.CLIENT_URL ? [process.env.CLIENT_URL, 'http://localhost:3000'] : true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
});

// API V1 Routes
app.use('/api/v1', apiRoutes);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Personal Job Application Assistant API',
    documentation: '/api/v1/health',
    status: 'ACTIVE'
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Start Server if executed directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`Job Application Assistant Backend Server Running`);
    console.log(`Port: ${PORT}`);
    console.log(`Health Check: http://localhost:${PORT}/api/v1/health`);
    console.log(`===================================================`);
  });
}

module.exports = app;
