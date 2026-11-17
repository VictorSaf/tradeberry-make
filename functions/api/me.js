// GET /api/me → {username, shared, admin, modules} of the signed-in user (the middleware has already refused anyone else with 401)
import { json } from '../../server/auth.js';

export function onRequestGet({ data }) {
  return json({ username: data.user.username, shared: data.user.shared, admin: data.user.admin, modules: data.user.modules || [] });
}
