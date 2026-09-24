import jwt from 'jsonwebtoken';

export function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export function admin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Government admin access required' });
  next();
}

export function agency(req, res, next) {
  if (!['admin', 'contractor'].includes(req.user?.role)) {
    return res.status(403).json({ message: 'Government or contractor access required' });
  }
  next();
}
