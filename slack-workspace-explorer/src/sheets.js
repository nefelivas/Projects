const { google } = require('googleapis');

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

async function syncToSheets(channels, botToken, teamName) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Use team name as tab name, fallback to 'Sheet1'
  const tabName = teamName ? teamName.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 30) : 'Sheet1';

  // Get existing sheets
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

  if (!existingSheets.includes(tabName)) {
    // Create new tab for this workspace
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: tabName }
          }
        }]
      }
    });
  }

  // Build rows from Supabase channel data
  const rows = [['Channel', 'Type', 'Members', 'Last Activity']];

  for (const ch of channels) {
    rows.push([
      ch.name,
      ch.is_private ? 'Private' : 'Public',
      ch.members || 'Bot not added',
      ch.last_activity ? new Date(ch.last_activity).toLocaleString() : 'No activity yet',
    ]);
  }

  // Clear and write
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${tabName}`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  console.log(`✅ Synced ${rows.length - 1} channels to Google Sheets tab: ${tabName}`);
  return rows.length - 1;
}

module.exports = { syncToSheets };
