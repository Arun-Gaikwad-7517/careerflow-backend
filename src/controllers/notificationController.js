const {
  getCandidateNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead
} = require('../services/notificationService');

/**
 * GET /api/v1/notifications
 */
async function getNotifications(req, res) {
  try {
    const userId = (req.user && (req.user.id || req.user.userId)) || 1;
    const result = await getCandidateNotifications(userId);

    return res.status(200).json({
      success: true,
      unreadCount: result.unreadCount,
      count: result.notifications.length,
      notifications: result.notifications
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve notifications.'
    });
  }
}

/**
 * PUT /api/v1/notifications/:id/read
 */
async function markSingleRead(req, res) {
  try {
    const notificationId = parseInt(req.params.id, 10);
    const userId = (req.user && (req.user.id || req.user.userId)) || 1;

    if (isNaN(notificationId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid notification ID.'
      });
    }

    const success = await markNotificationAsRead(notificationId, userId);
    return res.status(200).json({
      success,
      message: 'Notification marked as read.'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to update notification status.'
    });
  }
}

/**
 * PUT /api/v1/notifications/read-all
 */
async function markAllRead(req, res) {
  try {
    const userId = (req.user && (req.user.id || req.user.userId)) || 1;
    const success = await markAllNotificationsAsRead(userId);

    return res.status(200).json({
      success,
      message: 'All notifications marked as read.'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to mark all notifications as read.'
    });
  }
}

module.exports = {
  getNotifications,
  markSingleRead,
  markAllRead
};
