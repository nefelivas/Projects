const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../db');
const { syncWorkspaceToSupabase } = require('../slack');

router.get('/install', (req, res) => {
  const scopes = 'channels:read,groups:read,users:read,channels:history,groups:history,channels:manage,groups:write';
  const userScopes = 'channels:read,channels:write,channels:history,groups:read,groups:write,users:read';
  const url = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=${scopes}&user_scope=${userScopes}&redirect_uri=${process.env.REDIRECT_URI}`;
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) return res.redirect('/?error=access_denied');

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
    if (!data.ok) return res.redirect('/?error=oauth_failed');

    const { error: dbError } = await supabase
      .from('workspaces')
      .upsert({
        workspace_id: data.team.id,
        team_name: data.team.name,
        bot_token: data.access_token,
        user_token: data.authed_user.access_token,
        installed_at: new Date().toISOString()
      }, { onConflict: 'workspace_id' });

    if (dbError) {
      console.error('DB error:', dbError);
      return res.redirect('/?error=db_failed');
    }

    // Auto sync in background after install
    syncWorkspaceToSupabase(data.team.id, data.authed_user.access_token, data.access_token)
      .catch(err => console.error('Auto sync error:', err.message));

    res.redirect(`/dashboard?workspace=${data.team.id}`);

  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/?error=server_error');
  }
});

module.exports = router;
