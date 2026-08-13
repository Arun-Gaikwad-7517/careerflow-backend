const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { JWT_SECRET } = require('../middleware/authMiddleware');

/**
 * POST /api/v1/auth/login
 * Body: { email, password }
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.'
      });
    }

    // Query user record safely (never return password_hash in general API outputs)
    const rows = await query('SELECT id, full_name, email, role, password_hash FROM users WHERE email = ? LIMIT 1', [email]);

    if (!rows || rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials.'
      });
    }

    const user = rows[0];

    if (!user.password_hash) {
      return res.status(401).json({
        success: false,
        error: 'Password login is not set up for this account.'
      });
    }

    // Compare bcrypt password
    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials.'
      });
    }

    if (!JWT_SECRET) {
      console.error('[CRITICAL SECURITY ERROR]: JWT_SECRET environment variable is missing.');
      return res.status(500).json({
        success: false,
        error: 'Server security configuration error: JWT_SECRET is missing.'
      });
    }

    // Generate JWT signed token (8h expiration)
    const token = jwt.sign(
      { userId: user.id, id: user.id, email: user.email, role: user.role, fullName: user.full_name },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Set HTTP-Only Cookie (sameSite=none & secure=true in production for cross-site Vercel domains)
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'strict',
      secure: isProduction ? true : false,
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
      path: '/'
    });

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role
      }
    });

  } catch (err) {
    console.error('Login controller error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred during login.'
    });
  }
}

/**
 * POST /api/v1/auth/logout
 */
async function logout(req, res) {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('token', {
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'strict',
      secure: isProduction ? true : false,
      path: '/'
    });
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Logout failed.'
    });
  }
}

/**
 * GET /api/v1/auth/me
 * Protected by authenticateToken
 */
async function me(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthenticated.'
      });
    }

    const rows = await query('SELECT id, full_name, email, role, created_at FROM users WHERE id = ? LIMIT 1', [req.user.id || req.user.userId]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User account not found.'
      });
    }

    const u = rows[0];
    return res.status(200).json({
      success: true,
      user: {
        id: u.id,
        fullName: u.full_name,
        email: u.email,
        role: u.role,
        createdAt: u.created_at
      }
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve profile.'
    });
  }
}

module.exports = {
  login,
  logout,
  me
};
