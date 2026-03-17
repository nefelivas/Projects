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
        requests: [{
          addSheet: { properties: { title: tabName } }
        }]
      }
    });
  }
}

async function syncToSheets(channels, botToken, teamName) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const tabName = teamName ? teamName.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 30) : 'Sheet1';

  await ensureTab(sheets, spreadsheetId, tabName);

  const rows = [['Channel', 'Type', 'Members', 'Last Activity']];

  for (const ch of channels) {
    rows.push([
      ch.name,
      ch.is_private ? 'Private' : 'Public',
      ch.members || 'Bot not added',
      ch.last_activity ? new Date(ch.last_activity).toLocaleString() : 'No activity yet',
    ]);
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: tabName });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  console.log(`✅ Synced ${rows.length - 1} channels to tab: ${tabName}`);
  return rows.length - 1;
}

async function syncUsersToSheets() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureTab(sheets, spreadsheetId, 'Users');

  // Fetch users with their workspace name
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

module.exports = { syncToSheets, syncUsersToSheets };
