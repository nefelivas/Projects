const { WebClient } = require("@slack/web-api");
const supabase = require("./db");

function getClient(token) {
  return new WebClient(token || process.env.SLACK_BOT_TOKEN);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function buildUserMap(botClient) {
  const userMap = {};
  let cursor;
  do {
    const result = await botClient.users.list({ limit: 200, cursor });
    for (const u of result.members || []) {
      if (!u.is_bot && !u.is_app_user && u.id !== 'USLACKBOT' && !u.deleted) {
        userMap[u.id] = u.real_name || u.name;
      }
    }
    cursor = result.response_metadata?.next_cursor;
  } while (cursor);
  return userMap;
}

async function getLastActivity(channelId, botClient) {
  try {
    const result = await botClient.conversations.history({ channel: channelId, limit: 5 });
    if (result.messages && result.messages.length > 0) {
      const realMessage = result.messages.find(m => !m.subtype);
      if (realMessage) return Math.floor(parseFloat(realMessage.ts) * 1000);
    }
    return null;
  } catch (err) {
    if (err.data?.error === 'ratelimited') {
      const retryAfter = (err.retryAfter || 60) * 1000;
      console.log(`⏳ Rate limited on ${channelId}, waiting ${retryAfter / 1000}s...`);
      await sleep(retryAfter);
      try {
        const result = await botClient.conversations.history({ channel: channelId, limit: 5 });
        const realMessage = (result.messages || []).find(m => !m.subtype);
        if (realMessage) return Math.floor(parseFloat(realMessage.ts) * 1000);
      } catch { return null; }
    }
    return null;
  }
}

async function processChannel(ch, workspaceId, userClient, botClient, botUserId, userMap) {
  let botIsMember = false;
  let memberNames = [];
  let lastActivity = null;

  try {
    const membersResult = await userClient.conversations.members({ channel: ch.id });
    botIsMember = membersResult.members.includes(botUserId);
    if (botIsMember) {
      memberNames = membersResult.members.map(uid => userMap[uid]).filter(Boolean);
    }
  } catch (err) {
    console.log(`⚠️ Members failed ${ch.name}: ${err.data?.error || err.message}`);
    botIsMember = false;
  }

  if (botIsMember) {
    lastActivity = await getLastActivity(ch.id, botClient);
    await sleep(1300);
  }

  try {
    await supabase.from("channels").upsert({
      id: ch.id,
      workspace_id: workspaceId,
      name: ch.name,
      is_private: ch.is_private,
      member_count: botIsMember ? memberNames.length : (ch.num_members > 0 ? ch.num_members - 1 : 0),
      last_activity: lastActivity,
      bot_is_member: botIsMember,
      members: memberNames.join(", "),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id,workspace_id" });
    console.log(`✅ ${ch.name} | bot:${botIsMember} | activity:${lastActivity}`);
  } catch (err) {
    console.error(`❌ Save failed for ${ch.name}:`, err.message);
  }
}

async function syncWorkspaceToSupabase(workspaceId, userToken, botToken) {
  console.log(`🔄 Starting sync for workspace ${workspaceId}`);
  const userClient = getClient(userToken);
  const botClient = getClient(botToken);

  const [channelsResult, botInfo, userMap] = await Promise.all([
    userClient.conversations.list({ types: "public_channel,private_channel", exclude_archived: true, limit: 200 }),
    botClient.auth.test(),
    buildUserMap(botClient),
  ]);

  const channels = channelsResult.channels;
  const botUserId = botInfo.user_id;
  console.log(`📋 Found ${channels.length} channels`);

  for (let i = 0; i < channels.length; i++) {
    await processChannel(channels[i], workspaceId, userClient, botClient, botUserId, userMap);
    console.log(`📦 ${i + 1}/${channels.length}`);
  }

  console.log(`✅ Sync complete for workspace ${workspaceId}`);
}

async function getChannelsFromSupabase(workspaceId) {
  const { data, error } = await supabase.from("channels").select("*").eq("workspace_id", workspaceId).order("last_activity", { ascending: true, nullsFirst: true });
  if (error) throw error;
  return data;
}

async function getChannelMembers(channelId, botToken) {
  const client = getClient(botToken);
  const result = await client.conversations.members({ channel: channelId });
  const members = await Promise.all(result.members.map(async (userId) => {
    try {
      const userInfo = await client.users.info({ user: userId });
      const u = userInfo.user;
      return { id: u.id, name: u.real_name || u.name, display_name: u.profile?.display_name || u.name, email: u.profile?.email || null, is_bot: u.is_bot || u.is_app_user };
    } catch { return { id: userId, name: userId, is_bot: false }; }
  }));
  return members.filter((m) => !m.is_bot && m.id !== "USLACKBOT");
}

async function getAllMembers(botToken) {
  const client = getClient(botToken);
  const result = await client.users.list({ limit: 200 });
  return result.members
    .filter((u) => !u.is_bot && !u.deleted && u.id !== "USLACKBOT" && !u.is_app_user)
    .map((u) => ({ id: u.id, name: u.real_name || u.name, display_name: u.profile?.display_name || u.name, email: u.profile?.email || null }));
}

async function getMemberChannels(userId, workspaceId) {
  const { data, error } = await supabase.from("channels").select("*").eq("workspace_id", workspaceId);
  if (error) throw error;
  return data.filter(ch => {
    if (!ch.members) return false;
    return ch.members.split(", ").some(name => name.toLowerCase().includes(userId.toLowerCase()));
  });
}

module.exports = { syncWorkspaceToSupabase, getChannelsFromSupabase, getChannelMembers, getAllMembers, getMemberChannels };
