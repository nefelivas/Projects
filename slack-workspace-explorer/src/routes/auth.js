const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const supabase = require('../db');

router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });

    const { data: existing } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).single();
    if (existing) return res.status(400).json({ ok: false, error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users').insert({
      email: email.toLowerCase(),
      password: hash
    }).select().single();

    if (error) return res.status(500).json({ ok: false, error: error.message });

    req.session.userId = data.id;
    req.session.email = data.email;
    req.session.workspaceId = data.workspace_id;
    req.session.slackTeamId = data.slack_team_id;

    res.json({ ok: true, user: { email: data.email, workspace_id: data.workspace_id } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });

    const { data } = await supabase.from('users').select('*').eq('email', email.toLowerCase()).single();
    if (!data) return res.status(401).json({ ok: false, error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, data.password);
    if (!match) return res.status(401).json({ ok: false, error: 'Invalid email or password' });

    req.session.userId = data.id;
    req.session.email = data.email;
    req.session.workspaceId = data.workspace_id;
    req.session.slackTeamId = data.slack_team_id;

    res.json({ ok: true, user: { email: data.email, workspace_id: data.workspace_id } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  res.json({ ok: true, user: { email: req.session.email, workspace_id: req.session.workspaceId } });
});

module.exports = router;
