require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");

const apiRoutes = require("./routes/api");
const slackRoutes = require("./routes/slack");
const oauthRoutes = require("./routes/oauth");
const authRoutes = require("./routes/auth");
const { requireAuth, requireAuthAPI } = require("./middleware/requireAuth");
const { syncToSheets, syncAllToSheets, syncUsersToSheets } = require('./sheets');
const { syncWorkspaceToSupabase, getChannelsFromSupabase } = require('./slack');
const supabase = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  if (req.headers["content-type"] === "application/json") return next();
  let data = "";
  req.on("data", (chunk) => (data += chunk));
  req.on("end", () => {
    req.rawBody = data;
    next();
  });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'workspace-explorer-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Public auth routes
app.use("/api/auth", authRoutes);
app.use("/auth", oauthRoutes);
app.use("/slack", slackRoutes);

// Public sheets sync
app.post('/api/sheets/sync', async (req, res) => {
  try {
    const { data: workspaces } = await supabase.from("workspaces").select("*");
    for (const ws of workspaces || []) {
      await syncWorkspaceToSupabase(ws.workspace_id, ws.user_token, ws.bot_token);
      const channels = await getChannelsFromSupabase(ws.workspace_id);
      await syncToSheets(channels, ws.bot_token, ws.team_name);
    }
    await syncUsersToSheets();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Protected API routes
app.use("/api", requireAuthAPI, apiRoutes);

app.get("/health", (req, res) => res.json({ ok: true, ts: new Date() }));

// Pages
app.get("/", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "public", "landing.html"));
});

app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/install", requireAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "install.html")));
app.get("/picker", requireAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "picker.html")));
app.get("/dashboard", requireAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Hourly sync
setInterval(async () => {
  try {
    console.log('⏰ Running hourly sync for all workspaces...');
    const { data: workspaces } = await supabase.from("workspaces").select("*");
    for (const ws of workspaces || []) {
      await syncWorkspaceToSupabase(ws.workspace_id, ws.user_token, ws.bot_token);
      const channels = await getChannelsFromSupabase(ws.workspace_id);
      await syncToSheets(channels, ws.bot_token, ws.team_name);
    }
    await syncUsersToSheets();
    console.log('✅ Hourly sync complete');
  } catch (err) {
    console.error('Sync error:', err.message);
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`\n🚀 Workspace Explorer running at http://localhost:${PORT}`);
  console.log(`📋 REST API: http://localhost:${PORT}/api/channels`);
  console.log(`💬 Slack commands: /slack/channels and /slack/members\n`);
});
