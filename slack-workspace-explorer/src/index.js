require("dotenv").config();
const express = require("express");
const path = require("path");

const apiRoutes = require("./routes/api");
const slackRoutes = require("./routes/slack");
const oauthRoutes = require("./routes/oauth");
const authRoutes = require("./routes/auth");
const { syncToSheets } = require('./sheets');
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

app.use("/api", apiRoutes);
app.use("/api/auth", authRoutes);
app.use("/slack", slackRoutes);
app.use("/auth", oauthRoutes);

app.get("/health", (req, res) => res.json({ ok: true, ts: new Date() }));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "landing.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post('/api/sheets/sync', async (req, res) => {
  try {
    const { data: workspaces } = await supabase.from("workspaces").select("*");
    for (const ws of workspaces || []) {
      await syncWorkspaceToSupabase(ws.workspace_id, ws.user_token, ws.bot_token);
      const channels = await getChannelsFromSupabase(ws.workspace_id);
      await syncToSheets(channels, ws.bot_token, ws.team_name);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

setInterval(async () => {
  try {
    console.log('⏰ Running hourly sync for all workspaces...');
    const { data: workspaces } = await supabase.from("workspaces").select("*");
    for (const ws of workspaces || []) {
      await syncWorkspaceToSupabase(ws.workspace_id, ws.user_token, ws.bot_token);
      const channels = await getChannelsFromSupabase(ws.workspace_id);
      await syncToSheets(channels, ws.bot_token, ws.team_name);
    }
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
