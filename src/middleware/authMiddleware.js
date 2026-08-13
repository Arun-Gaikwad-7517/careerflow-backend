const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Middleware: Authenticates JWT token from HTTP-only cookie or Authorization header.
 * Attaches req.user = { id, email, role } if valid.
 */
function authenticateToken(req, res, next) {
  if (!JWT_SECRET) {
    console.error('[CRITICAL SECURITY ERROR]: JWT_SECRET environment variable is missing.');
    return res.status(500).json({
      success: false,
      error: 'Server security configuration error: JWT_SECRET is missing.'
    });
  }

  let token = null;

  // 1. Check HTTP-only Cookie
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  // 2. Check Authorization Header (Bearer <token>)
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please log in.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired session token. Please log in again.'
    });
  }
}

/**
 * Middleware: Requires req.user.role === 'ADMIN'.
 * Responds with HTTP 403 Forbidden for non-admin authenticated users.
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.'
    });
  }

  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Admin authorization required.'
    });
  }

  next();
}

module.exports = {
  authenticateToken,
  requireAdmin,
  JWT_SECRET
};
