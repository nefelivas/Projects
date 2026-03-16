const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { getChannels, getChannelMembers, getAllMembers, getMemberChannels } = require("../slack");

// Middleware: verify the request actually came from Slack
function verifySlackRequest(req, res, next) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const slackSignature = req.headers["x-slack-signature"];
  const timestamp = req.headers["x-slack-request-timestamp"];

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return res.status(400).send("Request too old");
  }

  const sigBaseString = `v0:${timestamp}:${req.rawBody}`;
  const mySignature = "v0=" + crypto
    .createHmac("sha256", signingSecret)
    .update(sigBaseString)
    .digest("hex");

  if (mySignature !== slackSignature) {
    return res.status(401).send("Invalid signature");
  }

  next();
}

// /channels — list all channels or show members of a specific one
router.post("/channels", verifySlackRequest, async (req, res) => {
  const text = (req.body.text || "").trim();

  try {
    if (!text) {
      const channels = await getChannels();
      const lines = channels.map(
        (ch) => `• *#${ch.name}* — ${ch.member_count} member(s)${ch.is_private ? " 🔒" : ""}`
      );
      return res.json({
        response_type: "ephemeral",
        text: `*Workspace Channels (${channels.length}):*\n${lines.join("\n")}`,
      });
    } else {
      const channels = await getChannels();
      const channel = channels.find((ch) => ch.name === text.replace(/^#/, ""));
      if (!channel) return res.json({ response_type: "ephemeral", text: `Channel *#${text}* not found.` });

      const members = await getChannelMembers(channel.id);
      const lines = members.map((m) => `• ${m.name} (@${m.display_name})`);
      return res.json({
        response_type: "ephemeral",
        text: `*Members of #${channel.name} (${members.length}):*\n${lines.join("\n")}`,
      });
    }
  } catch (err) {
    res.json({ response_type: "ephemeral", text: `Error: ${err.message}` });
  }
});

// /members — list all members or show channels of a specific one
router.post("/members", verifySlackRequest, async (req, res) => {
  const text = (req.body.text || "").trim();

  try {
    if (!text) {
      const members = await getAllMembers();
      const lines = members.map((m) => `• ${m.name} (@${m.display_name})`);
      return res.json({
        response_type: "ephemeral",
        text: `*Workspace Members (${members.length}):*\n${lines.join("\n")}`,
      });
    } else {
      const members = await getAllMembers();
      const member = members.find(
        (m) =>
          m.display_name.toLowerCase() === text.toLowerCase() ||
          m.name.toLowerCase() === text.toLowerCase()
      );
      if (!member) return res.json({ response_type: "ephemeral", text: `Member *${text}* not found.` });

      const channels = await getMemberChannels(member.id);
      const lines = channels.map((ch) => `• *#${ch.name}*${ch.is_private ? " 🔒" : ""}`);
      return res.json({
        response_type: "ephemeral",
        text: `*${member.name} is in ${channels.length} channel(s):*\n${lines.join("\n")}`,
      });
    }
  } catch (err) {
    res.json({ response_type: "ephemeral", text: `Error: ${err.message}` });
  }
});

module.exports = router;
