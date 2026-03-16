const { WebClient } = require("@slack/web-api");
const supabase = require("./db");

function getClient(token) {
  return new WebClient(token || process.env.SLACK_BOT_TOKEN);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getLastActivity(channelId, userToken, botToken) {
  for (const token of [userToken, botToken]) {
    if (!token) continue;
    const client = getClient(token);
    try {
      const result = await client.conversations.history({
        channel: channelId,
        limit: 5,
      });
      if (result.messages && result.messages.length > 0) {
        const realMessage = result.messages.find(m => !m.subtype);
        if (realMessage) {
        console.log(`✅ Got last activity for ${channelId}`);
        return Math.floor(parseFloat(realMessage.ts) * 1000);
}
      }
      return null;
    } catch (err) {
      console.log(`⚠️ History failed for ${channelId}: ${err.data?.error || err.message}`);
      continue;
    }
  }
  return null;
}

async function syncWorkspaceToSupabase(workspaceId, userToken, botToken) {
  console.log(`🔄 Starting sync for workspace ${workspaceId}`);
  const userClient = getClient(userToken);
  const botClient = getClient(botToken);

  const result = await userClient.conversations.list({
    types: "public_channel,private_channel",
    exclude_archived: true,
    limit: 200,
  });

  console.log(`📋 Found ${result.channels.length} channels to sync`);

  const botInfo = await botClient.auth.test();
  const botUserId = botInfo.user_id;

  for (const ch of result.channels) {
    let botIsMember = false;
    let memberNames = [];

    try {
      const membersResult = await userClient.conversations.members({ channel: ch.id });
      botIsMember = membersResult.members.includes(botUserId);

      if (botIsMember) {
        const memberDetails = await Promise.all(
          membersResult.members.map(async (userId) => {
            try {
              const info = await botClient.users.info({ user: userId });
              const u = info.user;
              if (u.is_bot || u.is_app_user || userId === 'USLACKBOT') return null;
              return u.real_name || u.name;
            } catch { return null; }
          })
        );
        memberNames = memberDetails.filter(Boolean);
      }
    } catch (err) {
      console.log(`⚠️ Members failed for ${ch.name}: ${err.data?.error || err.message}`);
      botIsMember = false;
    }

    await sleep(500);

    const lastActivity = await getLastActivity(ch.id, userToken, botToken);

    await sleep(500);

    try {
      const { error } = await supabase.from("channels").upsert({
        id: ch.id,
        workspace_id: workspaceId,
        name: ch.name,
        is_private: ch.is_private,
        member_count: ch.num_members > 0 ? ch.num_members - 1 : 0,
        last_activity: lastActivity,
        bot_is_member: botIsMember,
        members: memberNames.join(", "),
        updated_at: new Date().toISOString(),
      }, { onConflict: "id,workspace_id" });

      if (error) {
        console.error(`❌ Supabase save failed for ${ch.name}:`, error.message);
      } else {
        console.log(`📝 Saved ${ch.name}: last_activity=${lastActivity}, bot_is_member=${botIsMember}`);
      }
    } catch (err) {
      console.error(`❌ Unexpected error saving ${ch.name}:`, err.message);
    }
  }

  console.log(`✅ Synced ${result.channels.length} channels for workspace ${workspaceId}`);
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
