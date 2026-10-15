// Local test stack: Postgres + Supabase Auth (GoTrue) + PostgREST behind one URL,
// like a hosted Supabase project. For automated tests only.
//
//   bash devstack/fetch-binaries.sh
//   sudo -u <non-root user> node devstack/start.mjs     (Postgres refuses to run as root)
//
// Exposes http://127.0.0.1:54321 with /auth/v1 and /rest/v1, plus a mail
// catcher at http://127.0.0.1:54324/last?to=<email>.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataDir = process.env.DEVSTACK_DATA ?? path.join(process.env.HOME ?? '/tmp', '.zb-devstack');

const PORTS = { db: 54322, api: 54321, auth: 54329, rest: 54323, smtp: 54325, mail: 54324, templates: 54326 };
const JWT_SECRET = 'local-dev-jwt-secret-with-at-least-32-characters';

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}
function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
const ANON_KEY = signJwt({ role: 'anon', iss: 'supabase-local', iat: 1700000000, exp: 2000000000 });
const SERVICE_KEY = signJwt({ role: 'service_role', iss: 'supabase-local', iat: 1700000000, exp: 2000000000 });

const children = [];
function run(name, cmd, args, env) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(dataDir, `${name}.log`));
  p.stdout.pipe(log);
  p.stderr.pipe(log);
  p.on('exit', (code) => console.log(`[${name}] exited with ${code}`));
  children.push(p);
  return p;
}

async function waitFor(url, label, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${label} did not start`);
}

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

// 1. Postgres
const pgServer = new EmbeddedPostgres({
  databaseDir: path.join(dataDir, 'db'),
  user: 'postgres',
  password: 'postgres',
  port: PORTS.db,
  persistent: false,
  onLog: () => {},
});
await pgServer.initialise();
await pgServer.start();
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PORTS.db}/postgres`;
const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
await db.query(fs.readFileSync(path.join(here, 'init.sql'), 'utf8'));

// 2. Email templates + mail catcher
const templateServer = http.createServer((req, res) => {
  const file = path.join(root, 'supabase/email-templates', path.basename(req.url ?? ''));
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(file));
});
templateServer.listen(PORTS.templates, '127.0.0.1');

const mails = [];
const smtp = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  onAuth(_auth, _session, cb) {
    cb(null, { user: 'dev' });
  },
  onData(stream, session, cb) {
    simpleParser(stream).then((m) => {
      const text = `${m.subject ?? ''}\n${m.text ?? ''}\n${m.html || ''}`;
      const code = (text.match(/\b(\d{6,10})\b/) ?? [])[1] ?? null;
      mails.push({ to: m.to?.text ?? '', subject: m.subject, code, at: Date.now() });
      cb();
    }, cb);
  },
});
smtp.listen(PORTS.smtp, '127.0.0.1');
http
  .createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const to = u.searchParams.get('to') ?? '';
    const found = [...mails].reverse().find((m) => m.to.includes(to));
    res.writeHead(found ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(found ?? null));
  })
  .listen(PORTS.mail, '127.0.0.1');

// 3. Supabase Auth (GoTrue). It creates the auth schema itself.
const tpl = (n) => `http://127.0.0.1:${PORTS.templates}/${n}.html`;
run('auth', path.join(here, 'bin/auth'), [], {
  GOTRUE_API_HOST: '127.0.0.1',
  PORT: String(PORTS.auth),
  API_EXTERNAL_URL: `http://127.0.0.1:${PORTS.api}/auth/v1`,
  GOTRUE_DB_DRIVER: 'postgres',
  GOTRUE_DB_MIGRATIONS_PATH: path.join(here, 'bin/migrations'),
  GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:devpass@127.0.0.1:${PORTS.db}/postgres?sslmode=disable`,
  GOTRUE_SITE_URL: 'http://127.0.0.1:8080',
  GOTRUE_JWT_SECRET: JWT_SECRET,
  GOTRUE_JWT_EXP: '3600',
  GOTRUE_JWT_AUD: 'authenticated',
  GOTRUE_JWT_ADMIN_ROLES: 'service_role',
  GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
  GOTRUE_DISABLE_SIGNUP: 'false',
  GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
  GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
  GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'true',
  GOTRUE_MAILER_AUTOCONFIRM: 'false',
  GOTRUE_MAILER_OTP_LENGTH: '6',
  GOTRUE_MAILER_OTP_EXP: '3600',
  GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: tpl('magic_link'),
  GOTRUE_MAILER_TEMPLATES_CONFIRMATION: tpl('confirmation'),
  GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: 'Код для входа в «Звёздные баллы»',
  GOTRUE_MAILER_SUBJECTS_CONFIRMATION: 'Код для входа в «Звёздные баллы»',
  GOTRUE_SMTP_HOST: '127.0.0.1',
  GOTRUE_SMTP_PORT: String(PORTS.smtp),
  GOTRUE_SMTP_USER: 'dev',
  GOTRUE_SMTP_PASS: 'dev',
  GOTRUE_SMTP_ADMIN_EMAIL: 'noreply@zb.local',
  GOTRUE_SMTP_SENDER_NAME: 'Звёздные баллы',
  GOTRUE_SMTP_MAX_FREQUENCY: '1s',
  GOTRUE_RATE_LIMIT_EMAIL_SENT: '10000',
  GOTRUE_RATE_LIMIT_ANONYMOUS_USERS: '10000',
  GOTRUE_RATE_LIMIT_OTP: '10000',
  GOTRUE_RATE_LIMIT_VERIFY: '10000',
  GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '10000',
  GOTRUE_LOG_LEVEL: 'info',
});
await waitFor(`http://127.0.0.1:${PORTS.auth}/health`, 'auth');

// 4. Project migrations
await applyMigrations();

// 5. PostgREST
run('rest', path.join(here, 'bin/postgrest'), [], {
  PGRST_DB_URI: `postgres://authenticator:devpass@127.0.0.1:${PORTS.db}/postgres`,
  PGRST_DB_SCHEMAS: 'public',
  PGRST_DB_ANON_ROLE: 'anon',
  PGRST_JWT_SECRET: JWT_SECRET,
  PGRST_SERVER_PORT: String(PORTS.rest),
  PGRST_SERVER_HOST: '127.0.0.1',
  PGRST_DB_CHANNEL_ENABLED: 'true',
});
await waitFor(`http://127.0.0.1:${PORTS.rest}/`, 'rest');

// 6. One URL for both, with permissive CORS (like Supabase's gateway)
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,prefer,accept-profile,content-profile,x-supabase-api-version,range',
  'access-control-expose-headers': 'content-range,x-supabase-api-version',
  'access-control-max-age': '600',
};
http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
    const url = req.url ?? '/';
    let port;
    let rest;
    if (url.startsWith('/auth/v1')) [port, rest] = [PORTS.auth, url.slice('/auth/v1'.length) || '/'];
    else if (url.startsWith('/rest/v1')) [port, rest] = [PORTS.rest, url.slice('/rest/v1'.length) || '/'];
    else return res.writeHead(404, CORS).end();
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    delete headers.origin;
    const up = http.request({ host: '127.0.0.1', port, path: rest, method: req.method, headers }, (u) => {
      const h = { ...u.headers };
      for (const k of Object.keys(h)) if (k.startsWith('access-control-')) delete h[k];
      res.writeHead(u.statusCode ?? 502, { ...h, ...CORS });
      u.pipe(res);
    });
    up.on('error', () => res.writeHead(502, CORS).end());
    req.pipe(up);
  })
  .listen(PORTS.api, '127.0.0.1');

async function applyMigrations() {
  const dir = path.join(root, 'supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    console.log(`migration applied: ${f}`);
  }
}

const state = {
  url: `http://127.0.0.1:${PORTS.api}`,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  jwtSecret: JWT_SECRET,
  dbUrl: DB_URL,
  mailUrl: `http://127.0.0.1:${PORTS.mail}`,
};
fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(state, null, 2));
console.log(`devstack ready: ${state.url}  (state: ${path.join(dataDir, 'state.json')})`);

async function shutdown() {
  for (const c of children) c.kill('SIGTERM');
  try {
    await db.end();
    await pgServer.stop();
  } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
