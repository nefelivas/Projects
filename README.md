# 💡 IdeaBot — AI Idea Structurer for Slack

IdeaBot helps you turn messy, raw ideas into clear structured summaries — right inside Slack. Built for sharing across multiple workspaces.

---

## How It Works

1. Type `/idea [your raw thoughts]` in any Slack channel
2. The bot privately shows you a structured version of your idea
3. Review it, restructure it, or share it to the channel with one click

---

## Setup Guide

### 1. Host the App (Required for multi-workspace distribution)

You need a public URL so other workspaces can install your app. The easiest free option is **Railway**:

1. Go to [railway.app](https://railway.app) and sign up
2. Click **"New Project" → "Deploy from GitHub repo"** (push your code to GitHub first)
3. Add your environment variables in the Railway dashboard
4. Railway gives you a public URL like `https://ideabot-production.up.railway.app`

> **Alternatives:** Render.com, Heroku, Fly.io — all work the same way.

---

### 2. Create a Slack App

1. Go to https://api.slack.com/apps → **"Create New App" → "From scratch"**
2. Name it (e.g. `IdeaBot`) and pick your workspace

---

### 3. Configure OAuth & Permissions

Go to **OAuth & Permissions** and add these **Bot Token Scopes**:
- `chat:write`
- `chat:write.public`
- `commands`

Under **Redirect URLs**, add:
```
https://your-app-url.railway.app/slack/oauth_redirect
```

---

### 4. Enable Distribution (so others can install it)

Go to **Manage Distribution** → click **"Activate Public Distribution"**

This unlocks the OAuth flow so your manager (and anyone you share the link with) can install it in their own workspace.

---

### 5. Add the Slash Command

Go to **Slash Commands → Create New Command**:
- Command: `/idea`
- Request URL: `https://your-app-url.railway.app/slack/events`
- Short Description: `Structure your raw idea with AI`
- Usage Hint: `[your raw idea here]`

---

### 6. Copy Your Credentials

From **Basic Information → App Credentials**, copy:
- `Client ID` → `SLACK_CLIENT_ID`
- `Client Secret` → `SLACK_CLIENT_SECRET`
- `Signing Secret` → `SLACK_SIGNING_SECRET`

---

### 7. Set Environment Variables

```bash
cp .env.example .env
# Fill in your values
```

---

### 8. Run the App

```bash
npm install
npm start
```

---

## Sharing With Your Manager (or Anyone)

Once your app is deployed and distribution is enabled:

1. Send them your install link: `https://your-app-url.railway.app/slack/install`
2. They click **"Add to Slack"**
3. Slack asks them to authorize — they click **Allow**
4. `/idea` is now available in their workspace! 🎉

---

## Production Notes

- **Token storage:** Currently uses in-memory Map (resets on restart). Replace `tokenStore` in `app.js` with a real DB for production.
- **Idea storage:** Same — replace `ideaStore` with a DB for persistence.

---

## Tech Stack

- Slack Bolt (Node.js) — Slack app framework with OAuth support
- Anthropic Claude — AI structuring engine
- Express — landing page and OAuth endpoints
