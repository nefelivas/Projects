const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const supabase = require('../db');

router.post('/setup', async (req, res) => {
  try {
    const { workspace_id, password } = req.body;
    if (!workspace_id || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });

    const { data } = await supabase.from('workspaces').select('password').eq('workspace_id', workspace_id).single();
    if (!data) return res.status(404).json({ ok: false, error: 'Workspace not found' });
    if (data.password) return res.status(400).json({ ok: false, error: 'Password already set' });

    const hash = await bcrypt.hash(password, 10);
    await supabase.from('workspaces').update({ password: hash }).eq('workspace_id', workspace_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { workspace_id, password } = req.body;
    if (!workspace_id || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });

    const { data } = await supabase.from('workspaces').select('password').eq('workspace_id', workspace_id).single();
    if (!data) return res.status(404).json({ ok: false, error: 'Workspace not found' });
    if (!data.password) return res.status(400).json({ ok: false, error: 'No password set' });

    const match = await bcrypt.compare(password, data.password);
    if (!match) return res.status(401).json({ ok: false, error: 'Incorrect password' });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
