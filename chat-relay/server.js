require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const { Client } = require('ssh2');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// --- Database Configuration (SQLite) ---
const dbFile = path.join(__dirname, 'wendy.db');
const db = new sqlite3.Database(dbFile);

// Initialize DB Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        username TEXT,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, provider_id)
    )`);
});

// Helper for DB queries (Promise-based)
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
});

// --- Passport Configuration ---
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Admin Local Strategy
passport.use('admin-local', new LocalStrategy({
    usernameField: 'username',
    passwordField: 'password'
}, (username, password, done) => {
    console.log('Login attempt:', username);
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        console.log('Admin login success');
        return done(null, { id: 'admin', username: 'Admin', isAdmin: true });
    }
    console.log('Admin login fail');
    return done(null, false, { message: 'Invalid credentials' });
}));

// GitHub Strategy
passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: "https://chat.ymy-ai.app/auth/github/callback"
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const userId = crypto.createHash('md5').update('github' + profile.id).digest('hex');
        await dbRun(
            'INSERT INTO users (id, provider, provider_id, username, email) VALUES ($id, $provider, $provider_id, $username, $email) ON CONFLICT (provider, provider_id) DO UPDATE SET username = $username',
            {
                $id: userId,
                $provider: 'github',
                $provider_id: profile.id,
                $username: profile.username,
                $email: profile.emails ? profile.emails[0].value : null
            }
        );
        const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
        return done(null, { ...user, isAdmin: false });
    } catch (err) {
        return done(err);
    }
}));

// Google Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "https://chat.ymy-ai.app/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const userId = crypto.createHash('md5').update('google' + profile.id).digest('hex');
        await dbRun(
            'INSERT INTO users (id, provider, provider_id, username, email) VALUES ($id, $provider, $provider_id, $username, $email) ON CONFLICT (provider, provider_id) DO UPDATE SET username = $username',
            {
                $id: userId,
                $provider: 'google',
                $provider_id: profile.id,
                $username: profile.displayName,
                $email: profile.emails ? profile.emails[0].value : null
            }
        );
        const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
        return done(null, { ...user, isAdmin: false });
    } catch (err) {
        return done(err);
    }
}));

// --- Middleware Configuration ---
const sessionMiddleware = session({
    store: new SQLiteStore({ dir: __dirname, db: 'sessions.db' }),
    secret: process.env.SESSION_SECRET || 'wendy-default-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
        httpOnly: true,
        secure: true, // Cloudflare provides HTTPS
        sameSite: 'lax'
    }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

// --- Bridge Tokens Management ---
let bridgeTokens = new Map(); // token -> { user, expires }

const checkAuth = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    const token = req.query.token;
    if (token && bridgeTokens.has(token)) {
        const bridge = bridgeTokens.get(token);
        if (bridge.expires > Date.now()) return next();
    }
    res.status(401).send('Unauthorized');
};

const redirectWithToken = (req, res) => {
    const token = crypto.randomBytes(16).toString('hex');
    bridgeTokens.set(token, {
        user: req.user,
        expires: Date.now() + 60000 // 1 minute expiry
    });
    
    // Force session save before redirect
    req.session.save((err) => {
        if (err) console.error('Session save error:', err);
        // Clean and simple redirect. The Session Cookie is set by Express-Session automatically.
        // We pass the token in URL just to bridge the gap if the cookie isn't ready.
        res.send(`<script>
            window.location.href = '/?token=${token}';
        </script>`);
    });
};

// --- Paths & Workspace Management ---
const BASE_WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.env.HOME || process.env.USERPROFILE, '.openclaw/workspace');
const BASE_DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(process.env.HOME || process.env.USERPROFILE, 'Downloads');

const getUserPaths = (user) => {
    if (user.isAdmin) {
        return {
            workspace: BASE_WORKSPACE_DIR,
            downloads: BASE_DOWNLOADS_DIR,
            sessionKey: 'agent:main:main'
        };
    }
    const userWorkspace = path.join(BASE_WORKSPACE_DIR, 'users', user.id);
    const userDownloads = path.join(BASE_DOWNLOADS_DIR, 'users', user.id);
    if (!fs.existsSync(userWorkspace)) fs.mkdirSync(userWorkspace, { recursive: true });
    if (!fs.existsSync(userDownloads)) fs.mkdirSync(userDownloads, { recursive: true });
    return {
        workspace: userWorkspace,
        downloads: userDownloads,
        sessionKey: `agent:isolated:${user.id}`
    };
};

// --- Routes ---
app.use(express.static(path.join(__dirname, 'public')));

// Auth Routes
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.post('/auth/admin', passport.authenticate('admin-local', { failureRedirect: '/login.html' }), redirectWithToken);
app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));
app.get('/auth/github/callback', passport.authenticate('github', { failureRedirect: '/login.html' }), redirectWithToken);
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login.html' }), redirectWithToken);
app.get('/logout', (req, res) => { req.logout(() => res.redirect('/login')); });

app.get('/user-info', (req, res) => {
    console.log('User-info check. SessionID:', req.sessionID, 'Authenticated:', req.isAuthenticated(), 'User:', req.user ? req.user.username : 'none');
    if (req.isAuthenticated()) return res.json({ authenticated: true, user: req.user });
    
    // Check if bridge token is valid
    const token = req.query.token;
    console.log('Checking token:', token);
    if (token && bridgeTokens.has(token)) {
        const bridge = bridgeTokens.get(token);
        if (bridge.expires > Date.now()) {
            console.log('Valid bridge token found for user:', bridge.user.username);
            // Log them in for this session
            req.login(bridge.user, (err) => {
                if (err) {
                    console.error('req.login error:', err);
                    return res.status(500).json({ authenticated: false, error: 'Login error' });
                }
                req.session.save((err) => {
                    if (err) console.error('session.save error after token login:', err);
                    console.log('Session saved after token login. SessionID:', req.sessionID);
                    return res.json({ authenticated: true, user: bridge.user });
                });
            });
            return;
        } else {
            console.log('Expired bridge token');
        }
    }
    
    console.log('Unauthorized user-info request');
    res.status(401).json({ authenticated: false });
});

// File Handling Middleware for Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const { downloads } = getUserPaths(req.user);
        cb(null, downloads);
    },
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// File Routes (Scoped by User)
app.get('/list-files', checkAuth, (req, res) => {
    const { downloads } = getUserPaths(req.user);
    fs.readdir(downloads, (err, files) => {
        if (err) return res.status(500).send(err);
        res.send({ files: files.filter(f => !f.startsWith('.')) });
    });
});

app.get('/list-workspace', checkAuth, (req, res) => {
    const { workspace } = getUserPaths(req.user);
    fs.readdir(workspace, (err, files) => {
        if (err) return res.status(500).send(err);
        res.send({ files: files.filter(f => f.endsWith('.md')) });
    });
});

app.post('/upload', checkAuth, upload.array('files'), (req, res) => {
    res.send({ message: 'Files uploaded successfully', files: req.files.map(f => f.originalname) });
});

app.get('/download-file', checkAuth, (req, res) => {
    const { type, filename } = req.query;
    const paths = getUserPaths(req.user);
    let baseDir = type === 'workspace' ? paths.workspace : paths.downloads;
    const filePath = path.join(baseDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    res.download(filePath, filename);
});

// --- WebSocket Relay (Scoped by User) ---
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN;
const GATEWAY_PASSWORD = process.env.GATEWAY_PASSWORD;

// --- WebSocket & SSH Servers ---
const lobsterWss = new WebSocket.Server({ noServer: true });
lobsterWss.on('connection', (ws, req, user) => {
    if (!user.isAdmin) {
        ws.close(4003, 'Admin only');
        return;
    }
    const conn = new Client();
    conn.on('ready', () => {
        conn.shell((err, stream) => {
            if (err) return ws.close();
            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'data') stream.write(msg.data);
                if (msg.type === 'resize') stream.setWindow(msg.rows, msg.cols, 0, 0);
            });
            stream.on('data', (data) => ws.send(JSON.stringify({ type: 'data', data: data.toString('utf-8') })));
            stream.on('close', () => { conn.end(); ws.close(); });
        });
    }).on('error', () => ws.close()).connect({
        host: '127.0.0.1', port: 22, username: process.env.SSH_USER || 'zhangdaw', password: process.env.SSH_PASSWORD
    });
});

// --- Upgrade Handling ---
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token');
    
    const handleUpgrade = (user) => {
        const pathname = url.pathname;
        if (pathname === '/ssh-ws') {
            lobsterWss.handleUpgrade(request, socket, head, (ws) => {
                lobsterWss.emit('connection', ws, request, user);
            });
        } else if (pathname === '/') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                const { sessionKey } = getUserPaths(user);
                console.log(`Connecting to Gateway for user: ${user.username}, SessionKey: ${sessionKey}`);
                
                const gateway = new WebSocket(GATEWAY_URL, {
                    headers: { 'Origin': 'https://chat.ymy-ai.app' }
                });
                const msgQueue = [];

                gateway.on('open', () => {
                    console.log('Gateway connection opened');
                });

                gateway.on('message', (data) => {
                    const raw = data.toString();
                    try {
                        const msg = JSON.parse(raw);
                        
                        // Internal Handshake Logic (DO NOT PROXY TO CLIENT)
                        if (msg.event === 'connect.challenge') {
                            console.log('Gateway challenge received, handshaking...');
                            gateway.send(JSON.stringify({
                                type: 'req', id: 'handshake', method: 'connect',
                                params: {
                                    minProtocol: 3, maxProtocol: 3,
                                    client: { id: 'webchat-ui', version: '2.0.0', platform: 'web', mode: 'webchat' },
                                    role: 'operator',
                                    auth: { token: GATEWAY_TOKEN, password: GATEWAY_PASSWORD }
                                }
                            }));
                            return; // Stop here, client shouldn't see the challenge
                        }
                        
                        if (msg.type === 'res' && msg.id === 'handshake') {
                            if (msg.ok) {
                                console.log('Gateway handshake SUCCESS');
                                while (msgQueue.length > 0) {
                                    gateway.send(msgQueue.shift());
                                }
                            } else {
                                console.error('Gateway handshake FAILED:', msg.error || (msg.payload && msg.payload.message) || 'Unknown error');
                            }
                            return; // Stop here, client shouldn't see handshake result
                        }
                    } catch (e) {
                        console.error('Error parsing Gateway message:', e);
                    }
                    
                    // Proxy all other messages to client
                    if (ws.readyState === WebSocket.OPEN) {
                        if (raw.includes('agent') && raw.includes('payload')) {
                            const snippet = raw.substring(0, 300);
                            console.log(`[Gateway -> WS] ${user.username}: ${snippet}`);
                        }
                        ws.send(raw);
                    }
                });

                ws.on('message', (data) => {
                    const rawData = data.toString();
                    console.log(`[WS -> Gateway] ${rawData.substring(0, 200)}`);
                    try {
                        const msg = JSON.parse(rawData);
                        if (msg.method === 'chat.send') {
                            msg.params = msg.params || {};
                            msg.params.sessionKey = sessionKey;
                            // Ensure idempotencyKey exists
                            msg.params.idempotencyKey = msg.params.idempotencyKey || crypto.randomBytes(8).toString('hex');
                            
                            const finalMsg = JSON.stringify(msg);
                            if (gateway.readyState === WebSocket.OPEN) {
                                console.log(`[Relay -> Gateway] Sending chat.send for ${user.username}`);
                                gateway.send(finalMsg);
                            } else {
                                console.log(`[Relay -> Gateway] Queueing chat.send for ${user.username}`);
                                msgQueue.push(finalMsg);
                            }
                        } else {
                            if (gateway.readyState === WebSocket.OPEN) {
                                gateway.send(rawData);
                            } else {
                                msgQueue.push(rawData);
                            }
                        }
                    } catch (e) { console.error('WS Relay Error:', e); }
                });

                ws.on('close', () => {
                    console.log('Client WS closed, closing Gateway connection');
                    gateway.close();
                });

                gateway.on('error', (err) => {
                    console.error('Gateway WebSocket Error:', err);
                });
            });
        } else {
            socket.destroy();
        }
    };

    if (token && bridgeTokens.has(token)) {
        const bridge = bridgeTokens.get(token);
        if (bridge.expires > Date.now()) {
            return handleUpgrade(bridge.user);
        }
    }

    sessionMiddleware(request, {}, () => {
        if (!request.session || !request.session.passport || !request.session.passport.user) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        handleUpgrade(request.session.passport.user);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Relay running on port ${PORT} with SQLite`));
