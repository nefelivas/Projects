const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../db');
const { syncWorkspaceToSupabase } = require('../slack');
const { syncAllToSheets, syncUsersToSheets } = require('../sheets');

router.get('/install', (req, res) => {
  const scopes = 'channels:read,groups:read,users:read,channels:history,groups:history,channels:manage,groups:write';
  const userScopes = 'channels:read,channels:write,channels:history,groups:read,groups:write,users:read';

  let url = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=${scopes}&user_scope=${userScopes}&redirect_uri=${process.env.REDIRECT_URI}`;

  if (req.session.slackTeamId) {
    url += `&team=${req.session.slackTeamId}`;
  }

  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/install?error=access_denied');

  try {
    const response = await axios.post('https://slack.com/api/oauth.v2.access', null, {
      params: {
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: process.env.REDIRECT_URI
      }
    });

    const data = response.data;
    if (!data.ok) return res.redirect('/install?error=oauth_failed');

    // Save workspace to Supabase
    await supabase.from('workspaces').upsert({
      workspace_id: data.team.id,
      team_name: data.team.name,
      bot_token: data.access_token,
      user_token: data.authed_user.access_token,
      installed_at: new Date().toISOString()
    }, { onConflict: 'workspace_id' });

    // Link workspace to logged in user
    if (req.session.userId) {
      await supabase.from('users').update({
        workspace_id: data.team.id,
        slack_team_id: data.team.id
      }).eq('id', req.session.userId);
      req.session.workspaceId = data.team.id;
      req.session.slackTeamId = data.team.id;
    }

    // Sync Slack data to Supabase and Google Sheets in background
    syncWorkspaceToSupabase(data.team.id, data.authed_user.access_token, data.access_token)
      .then(() => syncAllToSheets())
      .then(() => syncUsersToSheets())
      .catch(err => console.error('Post-install sync error:', err.message));

    res.redirect(`/dashboard?workspace=${data.team.id}`);
  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/install?error=server_error');
  }
});

module.exports = router;
