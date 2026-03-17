const { google } = require('googleapis');
const supabase = require('./db');

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function ensureTab(sheets, spreadsheetId, tabName) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
  if (!existingSheets.includes(tabName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }]
      }
    });
  }
}

async function syncAllToSheets() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureTab(sheets, spreadsheetId, 'Channels');

  // Fetch all workspaces
  const { data: workspaces } = await supabase.from('workspaces').select('*');

  // Fetch all users to map workspace_id -> email
  const { data: users } = await supabase.from('users').select('email, workspace_id');
  const emailMap = {};
  for (const u of users || []) {
    if (u.workspace_id) emailMap[u.workspace_id] = u.email;
  }

  const rows = [['Channel', 'Type', 'Members', 'Last Activity', 'Workspace', 'Email']];

  for (const ws of workspaces || []) {
    const { data: channels } = await supabase
      .from('channels')
      .select('*')
      .eq('workspace_id', ws.workspace_id);

    const email = emailMap[ws.workspace_id] || '';

    for (const ch of channels || []) {
      rows.push([
        ch.name,
        ch.is_private ? 'Private' : 'Public',
        ch.members || 'Bot not added',
        ch.last_activity ? new Date(ch.last_activity).toLocaleString() : 'No activity yet',
        ws.team_name || ws.workspace_id,
        email
      ]);
    }
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Channels' });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Channels!A1',
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  console.log(`✅ Synced ${rows.length - 1} total channels to Google Sheets`);
}

async function syncUsersToSheets() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureTab(sheets, spreadsheetId, 'Users');

  const { data: users } = await supabase
    .from('users')
    .select('email, workspace_id, workspaces(team_name)')
    .not('workspace_id', 'is', null);

  const rows = [['Email', 'Workspace']];
  for (const user of users || []) {
    rows.push([
      user.email,
      user.workspaces?.team_name || user.workspace_id
    ]);
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Users' });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Users!A1',
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  console.log(`✅ Synced ${rows.length - 1} users to Google Sheets`);
}

async function syncToSheets(channels, botToken, teamName) {
  await syncAllToSheets();
}

module.exports = { syncToSheets, syncAllToSheets, syncUsersToSheets };
