#!/usr/bin/env python3
"""Honcho Dashboard API Bridge — SSE-powered realtime updates.
- REST endpoints (backward compatible)
- SSE endpoint /api/events with change detection
- Polls DB every 5s, pushes only changed data
- Heartbeat every 30s
- Event types: stats, sessions, conclusions, activity, health"""
import json
import re
import subprocess
import sys
import threading
import time
import hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs

try:
    from psycopg_pool import ConnectionPool
except Exception:
    ConnectionPool = None

PSQL = ['docker', 'exec', 'honcho-database-1', 'psql', '-U', 'postgres', '-t', '-c']
DB_CONNINFO = 'postgresql://postgres@127.0.0.1:5432/postgres'
PUBLIC_ID_RE = re.compile(r'^[A-Za-z0-9_-]{21}$')
WORKSPACE_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')

# --- State for change detection ---
_prev = {"stats": None, "sessions_hash": None, "conclusions_hash": None, "activity_hash": None}
_cache = {"stats": {}, "sessions": {"items": [], "total": 0}, "conclusions": {"items": [], "total": 0, "displayed": 0}, "activity": {"items": []}, "workspace_stats": {}}
_cache_lock = threading.Lock()
_sse_clients = []
_sse_lock = threading.Lock()
_last_poll_at = None
_last_poll_error = None
_db_pool = None

def log(msg):
    print(f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] {msg}", file=sys.stderr, flush=True)

def init_db_pool():
    global _db_pool
    if ConnectionPool is None:
        log("psycopg_pool unavailable; falling back to docker exec psql")
        return None
    try:
        pool = ConnectionPool(conninfo=DB_CONNINFO, min_size=1, max_size=4, open=False)
        pool.open(wait=True, timeout=5)
        _db_pool = pool
        log("Postgres connection pool ready")
    except Exception as e:
        _db_pool = None
        log(f"Postgres pool init failed; falling back to docker exec psql: {e}")
    return _db_pool

def query(sql):
    if _db_pool is not None:
        try:
            with _db_pool.connection(timeout=5) as conn:
                with conn.cursor() as cur:
                    cur.execute(sql)
                    row = cur.fetchone()
                    if row is None:
                        return [] if sql.strip().upper().startswith('SELECT') else None
                    return row[0]
        except Exception as e:
            log(f"pool query failed; falling back to docker exec psql: {e}")
    result = subprocess.run(PSQL + [sql], capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"psql exited {result.returncode}")
    out = result.stdout.strip()
    return json.loads(out) if out else ([] if sql.strip().upper().startswith('SELECT') else None)

def validate_public_id(value, label="id"):
    if not PUBLIC_ID_RE.match(value or ""):
        raise ValueError(f"Invalid {label}")
    return value

def validate_workspace(value):
    if not WORKSPACE_RE.match(value or ""):
        raise ValueError("Invalid workspace")
    return value

def pagination(params, default_size=200, max_size=500):
    try:
        page = int((params.get('page') or ['1'])[0])
        size = int((params.get('size') or [str(default_size)])[0])
    except (TypeError, ValueError):
        raise ValueError("Invalid pagination")
    page = max(1, page)
    size = min(max(1, size), max_size)
    offset = (page - 1) * size
    return page, size, offset

def hash_json(obj):
    return hashlib.md5(json.dumps(obj, sort_keys=True).encode()).hexdigest()

def broadcast(event_type, data):
    msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    with _sse_lock:
        dead = []
        for client in _sse_clients:
            try:
                client[1].write(msg.encode())
                client[1].flush()
            except:
                dead.append(client)
        for d in dead:
            _sse_clients.remove(d)

def poll_and_detect():
    global _last_poll_at, _last_poll_error
    while True:
        try:
            data = query("""
                SELECT json_build_object(
                    'stats', (SELECT json_build_object(
                        'workspaces', (SELECT COUNT(*) FROM workspaces),
                        'peers', (SELECT COUNT(*) FROM peers),
                        'sessions', (SELECT COUNT(*) FROM sessions),
                        'messages', (SELECT COUNT(*) FROM messages),
                        'conclusions', (SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL),
                        'sessions_today', (SELECT COUNT(*) FROM sessions WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date),
                        'conclusions_today', (SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date),
                        'today_timezone', 'Asia/Jakarta'
                    )),
                    'sessions', (SELECT json_agg(row_to_json(t)) FROM (
                        SELECT s.id, s.name, s.workspace_name, s.is_active, s.created_at,
                            (SELECT COUNT(*) FROM messages m WHERE m.session_name = s.name AND m.workspace_name = s.workspace_name) as message_count
                        FROM sessions s ORDER BY s.created_at DESC LIMIT 200
                    ) t),
                    'conclusions', (SELECT json_agg(row_to_json(t)) FROM (
                        SELECT id, LEFT(content, 200) as content, workspace_name, observer, observed, level, created_at
                        FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200
                    ) t),
                    'activity', (SELECT json_agg(row_to_json(t)) FROM (
                        SELECT 'session' as type, id, name as label, created_at FROM sessions
                        UNION ALL
                        SELECT 'conclusion' as type, id::text, LEFT(content, 100) as label, created_at
                        FROM documents WHERE deleted_at IS NULL
                        ORDER BY created_at DESC LIMIT 30
                    ) t),
                    'workspace_stats', (SELECT COALESCE(json_object_agg(
                        ws.name, (SELECT json_build_object(
                            'sessions', (SELECT COUNT(*) FROM sessions s WHERE s.workspace_name = ws.name),
                            'peers', (SELECT COUNT(*) FROM peers p WHERE p.workspace_name = ws.name),
                            'conclusions', (SELECT COUNT(*) FROM documents d WHERE d.workspace_name = ws.name AND d.deleted_at IS NULL),
                            'sessions_today', (SELECT COUNT(*) FROM sessions s WHERE s.workspace_name = ws.name AND (s.created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date),
                            'conclusions_today', (SELECT COUNT(*) FROM documents d WHERE d.workspace_name = ws.name AND d.deleted_at IS NULL AND (d.created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date)
                        ))
                    ), '{}'::json) FROM (SELECT name FROM workspaces ORDER BY name) ws)
                )""")
            if not data:
                time.sleep(5)
                continue

            d = data
            stats = d.get("stats", {})
            sessions = d.get("sessions") or []
            conclusions = d.get("conclusions") or []
            activity = d.get("activity") or []
            ws_stats = d.get("workspace_stats") or {}
            total_conclusions = int((stats or {}).get("conclusions") or len(conclusions))

            sessions_hash = hash_json(sessions)
            conclusions_hash = hash_json(conclusions)
            activity_hash = hash_json(activity)

            with _cache_lock:
                _cache["stats"] = stats
                _cache["sessions"] = {"items": sessions, "total": len(sessions)}
                _cache["conclusions"] = {"items": conclusions, "total": total_conclusions, "displayed": len(conclusions)}
                _cache["activity"] = {"items": activity}
                _cache["workspace_stats"] = ws_stats
                _last_poll_at = time.time()
                _last_poll_error = None

            # Change detection — only broadcast what changed
            if _prev["stats"] != stats:
                _prev["stats"] = stats
                broadcast("stats", stats)

            if _prev["sessions_hash"] != sessions_hash:
                _prev["sessions_hash"] = sessions_hash
                broadcast("sessions", {"items": sessions, "total": len(sessions)})

            if _prev["conclusions_hash"] != conclusions_hash:
                _prev["conclusions_hash"] = conclusions_hash
                broadcast("conclusions", {"items": conclusions, "total": total_conclusions, "displayed": len(conclusions)})

            if _prev["activity_hash"] != activity_hash:
                _prev["activity_hash"] = activity_hash
                broadcast("activity", {"items": activity})

        except Exception as e:
            _last_poll_error = str(e)
            log(f"poll error: {e}")
        time.sleep(5)

init_db_pool()
threading.Thread(target=poll_and_detect, daemon=True).start()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        try:
            # === SSE endpoint ===
            if path == '/api/events':
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Connection', 'keep-alive')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()

                client_id = id(self)
                client = (client_id, self.wfile)
                with _sse_lock:
                    _sse_clients.append(client)

                try:
                    # Send initial data immediately
                    with _cache_lock:
                        init = {
                            "stats": _cache["stats"],
                            "sessions": _cache["sessions"],
                            "conclusions": _cache["conclusions"],
                            "activity": _cache["activity"],
                            "workspace_stats": _cache.get("workspace_stats", {}),
                        }
                    self.wfile.write(f"event: init\ndata: {json.dumps(init)}\n\n".encode())
                    self.wfile.flush()

                    # Heartbeat loop
                    last_heartbeat = time.time()
                    while True:
                        now = time.time()
                        if now - last_heartbeat >= 30:
                            self.wfile.write(": heartbeat\n\n".encode())
                            self.wfile.flush()
                            last_heartbeat = now
                        time.sleep(1)
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass
                finally:
                    with _sse_lock:
                        if client in _sse_clients:
                            _sse_clients.remove(client)
                return

            # === REST endpoints (backward compatible) ===
            if path == '/api/health':
                with _cache_lock:
                    cache_age = None if _last_poll_at is None else round(time.time() - _last_poll_at, 3)
                    self._json({
                        "status": "ok" if _last_poll_error is None else "degraded",
                        "cache_age_seconds": cache_age,
                        "last_error": _last_poll_error,
                        "sse_clients": len(_sse_clients),
                        "sessions_cached": len(_cache.get("sessions", {}).get("items", [])),
                        "conclusions_cached": len(_cache.get("conclusions", {}).get("items", [])),
                    })

            elif path == '/api/all':
                with _cache_lock:
                    self._json({
                        "stats": _cache["stats"],
                        "sessions": _cache["sessions"],
                        "conclusions": _cache["conclusions"],
                        "workspace_stats": _cache.get("workspace_stats", {}),
                    })

            elif path == '/api/stats':
                with _cache_lock:
                    self._json(_cache["stats"])


            elif path == '/api/statistics':
                data = query("""
                    WITH workspace_distribution AS (
                        SELECT json_agg(row_to_json(t) ORDER BY t.workspace_name) AS data FROM (
                            SELECT w.name AS workspace_name,
                                (SELECT COUNT(*) FROM peers p WHERE p.workspace_name = w.name) AS peers,
                                (SELECT COUNT(*) FROM sessions s WHERE s.workspace_name = w.name) AS sessions,
                                (SELECT COUNT(*) FROM messages m WHERE m.workspace_name = w.name) AS messages,
                                (SELECT COUNT(*) FROM documents d WHERE d.workspace_name = w.name AND d.deleted_at IS NULL) AS conclusions,
                                (SELECT COUNT(*) FROM sessions s WHERE s.workspace_name = w.name AND (s.created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date) AS sessions_today,
                                (SELECT COUNT(*) FROM documents d WHERE d.workspace_name = w.name AND d.deleted_at IS NULL AND (d.created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date) AS conclusions_today
                            FROM workspaces w
                        ) t
                    ), memory_daily AS (
                        SELECT day::date, COALESCE(count(d.id), 0) AS daily
                        FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - interval '89 days', (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') day
                        LEFT JOIN documents d ON d.deleted_at IS NULL AND (d.created_at AT TIME ZONE 'Asia/Jakarta')::date = day::date
                        GROUP BY day::date ORDER BY day::date
                    ), memory_growth AS (
                        SELECT json_agg(row_to_json(t) ORDER BY t.date) AS data FROM (
                            SELECT day::text AS date, daily, SUM(daily) OVER (ORDER BY day) AS cumulative FROM memory_daily
                        ) t
                    ), session_daily AS (
                        SELECT day::date, COALESCE(count(s.id), 0) AS sessions
                        FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - interval '89 days', (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') day
                        LEFT JOIN sessions s ON (s.created_at AT TIME ZONE 'Asia/Jakarta')::date = day::date
                        GROUP BY day::date ORDER BY day::date
                    ), session_activity AS (
                        SELECT json_agg(row_to_json(t) ORDER BY t.date) AS data FROM (
                            SELECT day::text AS date, sessions FROM session_daily
                        ) t
                    ), peer_activity AS (
                        SELECT json_agg(row_to_json(t) ORDER BY t.messages DESC, t.peer_name) AS data FROM (
                            SELECT workspace_name, peer_name, COUNT(*) AS messages,
                                COUNT(DISTINCT session_name) AS sessions,
                                MAX(created_at) AS last_seen
                            FROM messages
                            GROUP BY workspace_name, peer_name
                            ORDER BY messages DESC, peer_name LIMIT 20
                        ) t
                    ), conclusion_levels AS (
                        SELECT json_agg(row_to_json(t) ORDER BY t.conclusions DESC) AS data FROM (
                            SELECT COALESCE(level, 'unknown') AS level, COUNT(*) AS conclusions
                            FROM documents WHERE deleted_at IS NULL
                            GROUP BY COALESCE(level, 'unknown')
                        ) t
                    )
                    SELECT json_build_object(
                        'generated_at', now(),
                        'today_timezone', 'Asia/Jakarta',
                        'stats', (SELECT json_build_object(
                            'workspaces', (SELECT COUNT(*) FROM workspaces),
                            'peers', (SELECT COUNT(*) FROM peers),
                            'sessions', (SELECT COUNT(*) FROM sessions),
                            'messages', (SELECT COUNT(*) FROM messages),
                            'conclusions', (SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL),
                            'sessions_today', (SELECT COUNT(*) FROM sessions WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date),
                            'conclusions_today', (SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date)
                        )),
                        'workspace_distribution', COALESCE((SELECT data FROM workspace_distribution), '[]'::json),
                        'memory_growth', COALESCE((SELECT data FROM memory_growth), '[]'::json),
                        'session_activity', COALESCE((SELECT data FROM session_activity), '[]'::json),
                        'peer_activity', COALESCE((SELECT data FROM peer_activity), '[]'::json),
                        'conclusion_levels', COALESCE((SELECT data FROM conclusion_levels), '[]'::json)
                    )
                """)
                self._json(data or {})

            elif path == '/api/sessions':
                page, size, offset = pagination(params, default_size=200)
                workspace = (params.get('workspace') or [''])[0].strip()
                if workspace:
                    workspace = validate_workspace(workspace)
                    data = query(f"""
                        SELECT json_agg(row_to_json(t)) FROM (
                            SELECT s.id, s.name, s.workspace_name, s.is_active, s.created_at,
                                (SELECT COUNT(*) FROM messages m WHERE m.session_name = s.name AND m.workspace_name = s.workspace_name) as message_count
                            FROM sessions s
                            WHERE s.workspace_name = '{workspace}'
                            ORDER BY s.created_at DESC LIMIT {size} OFFSET {offset}
                        ) t""")
                    total = query(f"SELECT COUNT(*) FROM sessions WHERE workspace_name = '{workspace}'")
                    self._json({"items": data or [], "total": int(total or 0), "page": page, "size": size, "displayed": len(data or []), "workspace": workspace})
                elif page == 1 and size >= 200:
                    with _cache_lock:
                        self._json(_cache["sessions"])
                else:
                    data = query(f"""
                        SELECT json_agg(row_to_json(t)) FROM (
                            SELECT s.id, s.name, s.workspace_name, s.is_active, s.created_at,
                                (SELECT COUNT(*) FROM messages m WHERE m.session_name = s.name AND m.workspace_name = s.workspace_name) as message_count
                            FROM sessions s ORDER BY s.created_at DESC LIMIT {size} OFFSET {offset}
                        ) t""")
                    with _cache_lock:
                        total = int((_cache.get("stats") or {}).get("sessions") or 0)
                    self._json({"items": data or [], "total": total, "page": page, "size": size, "displayed": len(data or [])})

            elif path == '/api/conclusions':
                page, size, offset = pagination(params, default_size=200)
                workspace = (params.get('workspace') or [''])[0].strip()
                if workspace:
                    workspace = validate_workspace(workspace)
                    data = query(f"""
                        SELECT json_agg(row_to_json(t)) FROM (
                            SELECT id, LEFT(content, 200) as content, workspace_name, observer, observed, level, created_at
                            FROM documents
                            WHERE deleted_at IS NULL AND workspace_name = '{workspace}'
                            ORDER BY created_at DESC LIMIT {size} OFFSET {offset}
                        ) t""")
                    total = query(f"SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND workspace_name = '{workspace}'")
                    self._json({"items": data or [], "total": int(total or 0), "page": page, "size": size, "displayed": len(data or []), "workspace": workspace})
                elif page == 1 and size >= 200:
                    with _cache_lock:
                        self._json(_cache["conclusions"])
                else:
                    data = query(f"""
                        SELECT json_agg(row_to_json(t)) FROM (
                            SELECT id, LEFT(content, 200) as content, workspace_name, observer, observed, level, created_at
                            FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT {size} OFFSET {offset}
                        ) t""")
                    with _cache_lock:
                        total = int((_cache.get("stats") or {}).get("conclusions") or 0)
                    self._json({"items": data or [], "total": total, "page": page, "size": size, "displayed": len(data or [])})

            elif path == '/api/activity':
                with _cache_lock:
                    self._json(_cache["activity"])

            elif path.startswith('/api/session/') and path.endswith('/messages'):
                session_id = validate_public_id(path.split('/')[3], "session_id")
                data = query(f"""
                    SELECT json_agg(row_to_json(t)) FROM (
                        SELECT m.id, m.content, m.peer_name, m.created_at
                        FROM messages m JOIN sessions s ON m.session_name = s.name AND m.workspace_name = s.workspace_name
                        WHERE s.id = '{session_id}'
                        ORDER BY m.created_at ASC
                    ) t""")
                self._json({"items": data or [], "total": len(data or [])})

            elif path.startswith('/api/session/'):
                session_id = validate_public_id(path.split('/')[3], "session_id")
                data = query(f"SELECT row_to_json(t) FROM (SELECT id, name, workspace_name, is_active, created_at FROM sessions WHERE id = '{session_id}') t")
                self._json(data or {"error": "Session not found"})

            elif path == '/api/search':
                q = (params.get('q', [''])[0] or '').strip()
                if not q:
                    self._json({"error": "Missing query parameter 'q'"}, 400)
                    return
                safe_q = q.replace("'", "''")
                data = query(f"""
                    SELECT json_agg(row_to_json(t)) FROM (
                        SELECT id, LEFT(content, 200) as content, workspace_name, observer, observed, level, created_at
                        FROM documents WHERE deleted_at IS NULL AND content ILIKE '%{safe_q}%'
                        ORDER BY created_at DESC LIMIT 50
                    ) t""")
                self._json({"items": data or [], "total": len(data or [])})

            else:
                self._json({"error": "Not found"}, 404)

        except ValueError as e:
            self._json({"error": str(e)}, 400)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return
        except Exception as e:
            log(f"request error {path}: {e}")
            self._json({"error": str(e)}, 500)

    def _json(self, data, status=200):
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def log_message(self, format, *args):
        pass

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    """Multi-threaded HTTP server — SSE clients don't block REST endpoints."""
    daemon_threads = True

if __name__ == '__main__':
    time.sleep(1)  # Wait for first cache fill
    server = ThreadingHTTPServer(('127.0.0.1', 9121), Handler)
    print("Honcho API Bridge running on port 9121 (SSE + REST, threaded)")
    server.serve_forever()
