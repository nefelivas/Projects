const { App, ExpressReceiver } = require("@slack/bolt");
const Anthropic = require("@anthropic-ai/sdk");
const crypto = require("crypto");
require("dotenv").config();

// ─── Token Store (swap for a real DB in production) ──────────────────────────
const tokenStore = new Map();

function saveWorkspaceToken(teamId, data) {
  tokenStore.set(teamId, data);
  // TODO: replace with DB write e.g. await db.upsert({ teamId, ...data })
}

function getWorkspaceToken(teamId) {
  return tokenStore.get(teamId);
  // TODO: replace with DB read e.g. return await db.findOne({ teamId })
}

// ─── OAuth-aware receiver (replaces Socket Mode) ─────────────────────────────
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET || crypto.randomBytes(16).toString("hex"),
  scopes: ["commands", "chat:write", "chat:write.public"],
  installationStore: {
    storeInstallation: async (installation) => {
      saveWorkspaceToken(installation.team.id, installation);
      console.log(`✅ Installed for workspace: ${installation.team.name}`);
    },
    fetchInstallation: async (installQuery) => {
      const data = getWorkspaceToken(installQuery.teamId);
      if (!data) throw new Error(`No installation found for team ${installQuery.teamId}`);
      return data;
    },
    deleteInstallation: async (installQuery) => {
      tokenStore.delete(installQuery.teamId);
    },
  },
});

const app = new App({ receiver });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Idea store (swap for a real DB in production) ───────────────────────────
const ideaStore = new Map();

// ─── Landing / Install page ───────────────────────────────────────────────────
receiver.router.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>IdeaBot — AI Idea Structurer for Slack</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;color:#1a1a1a}
        .hero{background:linear-gradient(135deg,#4A154B 0%,#7C3085 100%);color:white;padding:80px 24px;text-align:center}
        .hero h1{font-size:2.8rem;font-weight:800;margin-bottom:16px}
        .hero p{font-size:1.2rem;opacity:.9;max-width:560px;margin:0 auto 40px}
        .btn{display:inline-flex;align-items:center;gap:10px;background:white;color:#4A154B;font-weight:700;font-size:1rem;padding:14px 28px;border-radius:8px;text-decoration:none;transition:transform .15s,box-shadow .15s}
        .btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.18)}
        .features{display:flex;justify-content:center;gap:28px;flex-wrap:wrap;padding:64px 24px;max-width:960px;margin:0 auto}
        .card{background:white;border-radius:12px;padding:32px;width:260px;box-shadow:0 2px 12px rgba(0,0,0,.06);text-align:center}
        .card .icon{font-size:2.4rem;margin-bottom:12px}
        .card h3{font-size:1.05rem;margin-bottom:8px}
        .card p{font-size:.88rem;color:#666;line-height:1.6}
        .how{background:white;padding:64px 24px;text-align:center}
        .how h2{font-size:1.8rem;margin-bottom:40px}
        .steps{display:flex;justify-content:center;gap:24px;flex-wrap:wrap;max-width:800px;margin:0 auto}
        .step .num{background:#4A154B;color:white;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;margin:0 auto 12px}
        .step p{font-size:.9rem;color:#444;line-height:1.6;max-width:180px;margin:0 auto}
        footer{text-align:center;padding:32px;color:#999;font-size:.85rem}
        code{background:#f0e6f0;color:#4A154B;padding:2px 6px;border-radius:4px;font-size:.9em}
      </style>
    </head>
    <body>
      <div class="hero">
        <h1>💡 IdeaBot</h1>
        <p>Turn your messy, raw ideas into clear structured summaries — right inside Slack.</p>
        <a href="/slack/install" class="btn">
          <img src="https://platform.slack-edge.com/img/add_to_slack.png" height="20" alt="Slack logo"/>
          Add to Slack
        </a>
      </div>

      <div class="features">
        <div class="card"><div class="icon">⚡️</div><h3>Instant Structuring</h3><p>Type <code>/idea</code> followed by your raw thoughts and get a polished breakdown in seconds.</p></div>
        <div class="card"><div class="icon">🔒</div><h3>Private by Default</h3><p>Your idea is only visible to you until you decide to share it with your team.</p></div>
        <div class="card"><div class="icon">📢</div><h3>One-Click Sharing</h3><p>Post the structured idea to your channel with a single button click.</p></div>
      </div>

      <div class="how">
        <h2>How it works</h2>
        <div class="steps">
          <div class="step"><div class="num">1</div><p>Type <strong>/idea [your raw thoughts]</strong> in any channel</p></div>
          <div class="step"><div class="num">2</div><p>AI structures it privately — just for your eyes</p></div>
          <div class="step"><div class="num">3</div><p>Review, restructure, or share it to your team</p></div>
        </div>
      </div>

      <footer>Built with ❤️ using Slack Bolt &amp; Claude AI</footer>
    </body>
    </html>
  `);
});

// ─── AI: Structure the idea ───────────────────────────────────────────────────
async function structureIdea(rawIdea) {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: `You are an expert idea coach. A user has shared a raw idea with you. Your job is to structure it clearly.

Raw idea: "${rawIdea}"

Please return ONLY a JSON object with this exact structure (no markdown, no extra text):
{
  "title": "A short, catchy title for the idea (max 8 words)",
  "summary": "A one sentence summary of the idea",
  "target_audience": "Who this idea is for and why they need it",
  "problem": "The core problem this idea solves",
  "solution": "How the idea solves the problem",
  "next_steps": ["Step 1", "Step 2", "Step 3"]
}`,
      },
    ],
  });

  const text = message.content[0].text.trim();
  return JSON.parse(text);
}

// ─── Block Kit builder ────────────────────────────────────────────────────────
function buildIdeaBlocks(structured, rawIdea, ideaId) {
  return [
    { type: "header", text: { type: "plain_text", text: `💡 ${structured.title}`, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: `_${structured.summary}_` } },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*🎯 Target Audience*\n${structured.target_audience}` },
        { type: "mrkdwn", text: `*🔍 Problem*\n${structured.problem}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*🛠 Solution*\n${structured.solution}` } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🚀 Next Steps*\n${structured.next_steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
      },
    },
    { type: "divider" },
    { type: "context", elements: [{ type: "mrkdwn", text: `📝 *Your original idea:* _"${rawIdea}"_` }] },
    {
      type: "actions",
      block_id: `idea_actions_${ideaId}`,
      elements: [
        { type: "button", text: { type: "plain_text", text: "📢 Share to Channel", emoji: true }, style: "primary", action_id: "share_idea", value: ideaId },
        { type: "button", text: { type: "plain_text", text: "🔄 Restructure", emoji: true }, action_id: "restructure_idea", value: ideaId },
        { type: "button", text: { type: "plain_text", text: "🗑 Discard", emoji: true }, style: "danger", action_id: "discard_idea", value: ideaId },
      ],
    },
  ];
}

// ─── /idea slash command ──────────────────────────────────────────────────────
app.command("/idea", async ({ command, ack, respond }) => {
  await ack();
  const rawIdea = command.text.trim();

  if (!rawIdea) {
    await respond({ response_type: "ephemeral", text: "💡 Usage: `/idea [your raw idea here]`" });
    return;
  }

  await respond({ response_type: "ephemeral", text: "🧠 Structuring your idea... give me a second!" });

  try {
    const structured = await structureIdea(rawIdea);
    const ideaId = `${command.user_id}_${Date.now()}`;
    ideaStore.set(ideaId, { raw: rawIdea, structured, channel: command.channel_id, user: command.user_id });

    await respond({
      response_type: "ephemeral",
      text: "💡 Here's your structured idea:",
      blocks: buildIdeaBlocks(structured, rawIdea, ideaId),
    });
  } catch (err) {
    console.error("Error structuring idea:", err);
    await respond({ response_type: "ephemeral", text: "❌ Something went wrong. Please try again!" });
  }
});

// ─── Share to channel ─────────────────────────────────────────────────────────
app.action("share_idea", async ({ ack, body, client }) => {
  await ack();
  const ideaId = body.actions[0].value;
  const idea = ideaStore.get(ideaId);

  if (!idea) {
    await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "❌ Idea not found. Run `/idea` again." });
    return;
  }

  await client.chat.postMessage({
    channel: idea.channel,
    text: `💡 Idea shared by <@${idea.user}>`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `💡 *Idea shared by <@${idea.user}>*` } },
      ...buildIdeaBlocks(idea.structured, idea.raw, ideaId).slice(0, -1),
    ],
  });

  await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "✅ Your idea has been shared to the channel!" });
  ideaStore.delete(ideaId);
});

// ─── Restructure ──────────────────────────────────────────────────────────────
app.action("restructure_idea", async ({ ack, body, client }) => {
  await ack();
  const ideaId = body.actions[0].value;
  const idea = ideaStore.get(ideaId);

  if (!idea) {
    await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "❌ Idea not found. Run `/idea` again." });
    return;
  }

  await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "🔄 Re-structuring with a fresh perspective..." });

  try {
    const newStructured = await structureIdea(idea.raw);
    const newIdeaId = `${body.user.id}_${Date.now()}`;
    ideaStore.set(newIdeaId, { ...idea, structured: newStructured });
    ideaStore.delete(ideaId);

    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: "💡 Here's a fresh take:",
      blocks: buildIdeaBlocks(newStructured, idea.raw, newIdeaId),
    });
  } catch (err) {
    console.error("Restructure error:", err);
    await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "❌ Failed to restructure. Please try again." });
  }
});

// ─── Discard ───────────────────────────────────────────────────────────────────
app.action("discard_idea", async ({ ack, body, client }) => {
  await ack();
  ideaStore.delete(body.actions[0].value);
  await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "🗑 Idea discarded. Run `/idea` anytime!" });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ IdeaBot is running on port ${port}`);
  console.log(`🌍 Landing page: http://localhost:${port}/`);
  console.log(`🔗 Install URL:  http://localhost:${port}/slack/install`);
})();
