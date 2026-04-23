const express = require("express");
const router = express.Router();
const { syncWorkspaceToSupabase, getChannelsFromSupabase, getChannelMembers, getAllMembers, getMemberChannels } = require("../slack");
const { WebClient } = require("@slack/web-api");
const supabase = require("../db");

async function getTokens(req) {
  const workspaceId = req.query.workspace_id;
  if (workspaceId) {
    const { data } = await supabase
      .from("workspaces")
      .select("bot_token, user_token, workspace_id")
      .eq("workspace_id", workspaceId)
      .single();
    if (data) return data;
  }
  return {
    bot_token: process.env.SLACK_BOT_TOKEN,
    user_token: process.env.SLACK_USER_TOKEN,
    workspace_id: null
  };
}

router.get("/channels", async (req, res) => {
  try {
    const { workspace_id } = await getTokens(req);
    if (!workspace_id) return res.json({ ok: true, channels: [] });
    const channels = await getChannelsFromSupabase(workspace_id);
    res.json({ ok: true, channels });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/channels/:id/members", async (req, res) => {
  try {
    const tokens = await getTokens(req);
    const members = await getChannelMembers(req.params.id, tokens.bot_token);
    res.json({ ok: true, members });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/members", async (req, res) => {
  try {
    const tokens = await getTokens(req);
    const members = await getAllMembers(tokens.bot_token);
    res.json({ ok: true, members });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/members/:id/channels", async (req, res) => {
  try {
    const tokens = await getTokens(req);
    const client = new WebClient(tokens.bot_token);
    const userInfo = await client.users.info({ user: req.params.id });
    const memberName = userInfo.user.real_name || userInfo.user.name;
    const channels = await getMemberChannels(memberName, tokens.workspace_id);
    res.json({ ok: true, channels });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/sync/progress", async (req, res) => {
  const tokens = await getTokens(req);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const userClient = new WebClient(tokens.user_token);
    const channelsResult = await userClient.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
    });
    const total = channelsResult.channels.length;
    let done = 0;

    send({ type: "start", total });

    await syncWorkspaceToSupabase(
      tokens.workspace_id,
      tokens.user_token,
      tokens.bot_token,
      (channelName) => {
        done++;
        send({ type: "progress", done, total, channel: channelName });
      }
    );

    send({ type: "done" });
  } catch (err) {
    send({ type: "error", message: err.message });
  }

  res.end();
});

router.post("/sync", async (req, res) => {
  try {
    const tokens = await getTokens(req);
    await syncWorkspaceToSupabase(tokens.workspace_id, tokens.user_token, tokens.bot_token);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/channels/:id/invite", async (req, res) => {
  try {
    const tokens = await getTokens(req);
    const botClient = new WebClient(tokens.bot_token);
    const userClient = new WebClient(tokens.user_token);
    const botInfo = await botClient.auth.test();
    await userClient.conversations.invite({ channel: req.params.id, users: botInfo.user_id });
    await supabase.from("channels").update({ bot_is_member: true })
      .eq("id", req.params.id)
      .eq("workspace_id", tokens.workspace_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/channels/:id/remove", async (req, res) => {
  try {
    const tokens = await getTokens(req);
    const botClient = new WebClient(tokens.bot_token);
    const userClient = new WebClient(tokens.user_token);
    const botInfo = await botClient.auth.test();
    await userClient.conversations.kick({ channel: req.params.id, user: botInfo.user_id });
    await supabase.from("channels").update({ bot_is_member: false })
      .eq("id", req.params.id)
      .eq("workspace_id", tokens.workspace_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/public/invite", async (req, res) => {
  try {
    const tokens = await getTokens(req);
    const botClient = new WebClient(tokens.bot_token);
    const userClient = new WebClient(tokens.user_token);
    const botInfo = await botClient.auth.test();
    const botUserId = botInfo.user_id;
    const result = await userClient.conversations.list({
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
    });
    let success = 0, alreadyIn = 0, failed = 0;
    for (const channel of result.channels) {
      try {
        const membersRes = await userClient.conversations.members({ channel: channel.id });
        if (membersRes.members.includes(botUserId)) { alreadyIn++; continue; }
        await botClient.conversations.join({ channel: channel.id });
        await supabase.from("channels").update({ bot_is_member: true })
          .eq("id", channel.id)
          .eq("workspace_id", tokens.workspace_id);
        success++;
        await new Promise(r => setTimeout(r, 400));
      } catch (e) { failed++; }
    }
    res.json({ ok: true, success, alreadyIn, failed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/private/invite", async (req, res) => {
  try {
    const tokens = await getTokens(req);
    const botClient = new WebClient(tokens.bot_token);
    const userClient = new WebClient(tokens.user_token);
    const botInfo = await botClient.auth.test();
    const botUserId = botInfo.user_id;
    const result = await userClient.conversations.list({
      types: "private_channel",
      exclude_archived: true,
      limit: 200,
    });
    let success = 0, alreadyIn = 0, failed = 0;
    for (const channel of result.channels) {
      try {
        const members = await userClient.conversations.members({ channel: channel.id });
        if (members.members.includes(botUserId)) { alreadyIn++; continue; }
        await userClient.conversations.invite({ channel: channel.id, users: botUserId });
        await supabase.from("channels").update({ bot_is_member: true })
          .eq("id", channel.id)
          .eq("workspace_id", tokens.workspace_id);
        success++;
      } catch { failed++; }
    }
    res.json({ ok: true, success, alreadyIn, failed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/private/remove", async (req, res) => {
  try {
    const tokens = await getTokens(req);
    const botClient = new WebClient(tokens.bot_token);
    const userClient = new WebClient(tokens.user_token);
    const botInfo = await botClient.auth.test();
    const botUserId = botInfo.user_id;
    const result = await userClient.conversations.list({
      types: "private_channel",
      exclude_archived: true,
      limit: 200,
    });
    let success = 0, failed = 0;
    for (const channel of result.channels) {
      try {
        const members = await userClient.conversations.members({ channel: channel.id });
        if (!members.members.includes(botUserId)) continue;
        await userClient.conversations.kick({ channel: channel.id, user: botUserId });
        await supabase.from("channels").update({ bot_is_member: false })
          .eq("id", channel.id)
          .eq("workspace_id", tokens.workspace_id);
        success++;
      } catch { failed++; }
    }
    res.json({ ok: true, success, failed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/debug/history/:channelId", async (req, res) => {
  try {
    const tokens = await getTokens(req);
    const results = {};
    try {
      const userClient = new WebClient(tokens.user_token);
      const r = await userClient.conversations.history({ channel: req.params.channelId, limit: 1 });
      results.user_token = { ok: true, messages: r.messages?.length };
    } catch (e) {
      results.user_token = { ok: false, error: e.data?.error || e.message };
    }
    try {
      const botClient = new WebClient(tokens.bot_token);
      const r = await botClient.conversations.history({ channel: req.params.channelId, limit: 1 });
      results.bot_token = { ok: true, messages: r.messages?.length };
    } catch (e) {
      results.bot_token = { ok: false, error: e.data?.error || e.message };
    }
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/workspace-name", async (req, res) => {
  try {
    const { workspace_id } = await getTokens(req);
    if (!workspace_id) return res.json({ ok: false });
    const { data } = await supabase.from("workspaces").select("team_name").eq("workspace_id", workspace_id).single();
    res.json({ ok: true, name: data?.team_name || workspace_id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
