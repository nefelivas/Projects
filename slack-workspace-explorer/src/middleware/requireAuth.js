function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

function requireAuthAPI(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }
  next();
}

module.exports = { requireAuth, requireAuthAPI };
