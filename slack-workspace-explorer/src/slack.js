const { WebClient } = require("@slack/web-api");

const client = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * Fetch all public (and optionally private) channels in the workspace
 */
async function getChannels() {
  const result = await client.conversations.list({
    types: "public_channel,private_channel",
    exclude_archived: true,
    limit: 200,
  });

  return result.channels.map((ch) => ({
    id: ch.id,
    name: ch.name,
    is_private: ch.is_private,
    member_count: ch.num_members,
    topic: ch.topic?.value || "",
    purpose: ch.purpose?.value || "",
  }));
}

/**
 * Fetch all members of a specific channel by channel ID
 */
async function getChannelMembers(channelId) {
  const result = await client.conversations.members({ channel: channelId });
  const memberIds = result.members;

  // Fetch full user info for each member
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
          is_bot: u.is_bot,
        };
      } catch {
        return { id: userId, name: userId, is_bot: false };
      }
    })
  );

  return members.filter((m) => !m.is_bot);
}

/**
 * Fetch all non-bot workspace members
 */
async function getAllMembers() {
  const result = await client.users.list({ limit: 200 });

  return result.members
    .filter((u) => !u.is_bot && !u.deleted && u.id !== "USLACKBOT")
    .map((u) => ({
      id: u.id,
      name: u.real_name || u.name,
      display_name: u.profile?.display_name || u.name,
      email: u.profile?.email || null,
    }));
}

/**
 * Fetch all channels a specific member belongs to
 */
async function getMemberChannels(userId) {
  // Get all channels, then filter by membership
  const allChannels = await getChannels();

  const memberChannels = await Promise.all(
    allChannels.map(async (ch) => {
      try {
        const membersResult = await client.conversations.members({
          channel: ch.id,
        });
        if (membersResult.members.includes(userId)) return ch;
        return null;
      } catch {
        return null;
      }
    })
  );

  return memberChannels.filter(Boolean);
}

module.exports = { getChannels, getChannelMembers, getAllMembers, getMemberChannels };
