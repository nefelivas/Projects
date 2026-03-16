require("dotenv").config();
const { WebClient } = require("@slack/web-api");

const botClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const userClient = new WebClient(process.env.SLACK_USER_TOKEN);

async function getBotUserId() {
  const result = await botClient.auth.test();
  return result.user_id;
}

async function bulkInvite() {
  console.log("Starting bulk invite...\n");

  const botUserId = await getBotUserId();
  console.log("Bot user ID: " + botUserId + "\n");

  const result = await userClient.conversations.list({
    types: "public_channel,private_channel",
    exclude_archived: true,
    limit: 200,
  });

  const channels = result.channels;
  console.log("Found " + channels.length + " channels total\n");

  let success = 0;
  let alreadyIn = 0;
  let failed = 0;

  for (const channel of channels) {
    try {
      const members = await userClient.conversations.members({
        channel: channel.id,
      });

      if (members.members.includes(botUserId)) {
        console.log("Already in #" + channel.name + " - skipping");
        alreadyIn++;
        continue;
      }

      await userClient.conversations.invite({
        channel: channel.id,
        users: botUserId,
      });

      console.log("Invited bot to #" + channel.name);
      success++;

    } catch (err) {
      console.log("Failed for #" + channel.name + ": " + err.message);
      failed++;
    }
  }

  console.log("\nResults:");
  console.log("Successfully invited: " + success);
  console.log("Already a member: " + alreadyIn);
  console.log("Failed: " + failed);
  console.log("\nBulk invite complete!");
}

bulkInvite().catch(console.error);