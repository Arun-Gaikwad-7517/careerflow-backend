// Vercel Serverless Function Entry Point for CareerFlow Express Backend API
const app = require('../src/app');

module.exports = (req, res) => {
  app(req, res);
};
