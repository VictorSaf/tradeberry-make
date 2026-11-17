// POST/GET /api/lease → 423 {since: now}, always. The account runs on the execution server (host/gateway.mjs) since
// v16; this stub is for a page of an older build still open somewhere: its cloud.js asks for the lease at boot and every
// 40 s, takes 423 as "open on another device", shows that overlay, stops its engine (Engine.speed = 0) and refuses
// openPosition / placeOrder / closePosition, so it never executes on the account in the browser again; "Use it here"
// gets 423 too and stays stopped. Its PUT /api/state {base, state} gets 423 as well (functions/api/state.js).
import { json, now } from '../../server/auth.js';

const stopped = () => json({ error: 'Open on another device', since: now() }, 423);
export const onRequestPost = stopped;
export const onRequestGet = stopped;
