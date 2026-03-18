const { WebClient } = require("@slack/web-api");
const supabase = require("./db");

function getClient(token) {
  return new WebClient(token || process.env.SLACK_BOT_TOKEN);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch all users once and build a map — much faster than one call per user
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

async function getLastActivity(channelId, userToken, botToken) {
  for (const token of [userToken, botToken]) {
    if (!token) continue;
    const client = getClient(token);
    try {
      const result = await client.conversations.history({ channel: channelId, limit: 5 });
      if (result.messages && result.messages.length > 0) {
        const realMessage = result.messages.find(m => !m.subtype);
        if (realMessage) return Math.floor(parseFloat(realMessage.ts) * 1000);
      }
      return null;
    } catch (err) {
      continue;
    }
  }
  return null;
}

// Process a single channel
async function processChannel(ch, workspaceId, userClient, botClient, botUserId, userMap) {
  let botIsMember = false;
  let memberNames = [];
  let lastActivity = null;

  try {
    const membersResult = await userClient.conversations.members({ channel: ch.id });
    botIsMember = membersResult.members.includes(botUserId);

    if (botIsMember) {
      // Use pre-built userMap instead of calling users.info per user
      memberNames = membersResult.members
        .map(uid => userMap[uid])
        .filter(Boolean);

      // Fetch last activity in parallel with member processing
      lastActivity = await getLastActivity(ch.id, null, null);
      // Try with bot token since bot is a member
      if (!lastActivity) {
        try {
          const hist = await botClient.conversations.history({ channel: ch.id, limit: 5 });
          const real = (hist.messages || []).find(m => !m.subtype);
          if (real) lastActivity = Math.floor(parseFloat(real.ts) * 1000);
        } catch {}
      }
    }
  } catch (err) {
    console.log(`⚠️ Failed ${ch.name}: ${err.data?.error || err.message}`);
    botIsMember = false;
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
    console.log(`✅ ${ch.name}`);
  } catch (err) {
    console.error(`❌ Save failed for ${ch.name}:`, err.message);
  }
}

async function syncWorkspaceToSupabase(workspaceId, userToken, botToken) {
  console.log(`🔄 Starting sync for workspace ${workspaceId}`);
  const userClient = getClient(userToken);
  const botClient = getClient(botToken);

  // Fetch channels and user map in parallel
  const [channelsResult, botInfo, userMap] = await Promise.all([
    userClient.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
    }),
    botClient.auth.test(),
    buildUserMap(botClient),
  ]);

  const channels = channelsResult.channels;
  const botUserId = botInfo.user_id;
  console.log(`📋 Found ${channels.length} channels, ${Object.keys(userMap).length} users`);

  // Process in batches of 5 to stay within rate limits but go faster
  const BATCH_SIZE = 5;
  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(ch => processChannel(ch, workspaceId, userClient, botClient, botUserId, userMap))
    );
    // Small pause between batches to respect rate limits
    if (i + BATCH_SIZE < channels.length) await sleep(200);
    console.log(`📦 Processed ${Math.min(i + BATCH_SIZE, channels.length)}/${channels.length}`);
  }

  console.log(`✅ Sync complete for workspace ${workspaceId}`);
}

async function getChannelsFromSupabase(workspaceId) {
  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("last_activity", { ascending: true, nullsFirst: true });

  if (error) throw error;
  return data;
}

async function getChannelMembers(channelId, botToken) {
  const client = getClient(botToken);
  const result = await client.conversations.members({ channel: channelId });
  const memberIds = result.members;

  const members = await Promise.all(
    memberIds.map(async (userId) => {
      try {
        const userInfo = await client.users.info({ user: userId });
        const u = userInfo.user;
        return {
          id: u.id,
          name: u.real_name || u.name,
          display_name: u.profile?.display_name || u.name,
          email: u.profile?.email || null,
          is_bot: u.is_bot || u.is_app_user,
        };
      } catch {
        return { id: userId, name: userId, is_bot: false };
      }
    })
  );

  return members.filter((m) => !m.is_bot && m.id !== "USLACKBOT");
}

async function getAllMembers(botToken) {
  const client = getClient(botToken);
  const result = await client.users.list({ limit: 200 });

  return result.members
    .filter((u) => !u.is_bot && !u.deleted && u.id !== "USLACKBOT" && !u.is_app_user)
    .map((u) => ({
      id: u.id,
      name: u.real_name || u.name,
      display_name: u.profile?.display_name || u.name,
      email: u.profile?.email || null,
    }));
}

async function getMemberChannels(userId, workspaceId) {
  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (error) throw error;

  return data.filter(ch => {
    if (!ch.members) return false;
    return ch.members.split(", ").some(name => name.toLowerCase().includes(userId.toLowerCase()));
  });
}

module.exports = { syncWorkspaceToSupabase, getChannelsFromSupabase, getChannelMembers, getAllMembers, getMemberChannels };
