// api/chatfuel.js
// Serverless function for Vercel — bridges Chatfuel <-> Dialogflow ES (v2)

const { SessionsClient } = require('@google-cloud/dialogflow');

// Read env vars
const DF_PROJECT_ID = process.env.DF_PROJECT_ID; // e.g., autosalesbot-qw9j
const CREDS_JSON = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON; // the full JSON key as a string
const BOT_SECRET = process.env.BOT_SECRET; // optional, for a header check like X-Secret

// Create a singleton SessionsClient using inline credentials
let sessionClient;
function getClient() {
  if (!sessionClient) {
    if (!DF_PROJECT_ID || !CREDS_JSON) {
      throw new Error('Missing DF_PROJECT_ID or GOOGLE_APPLICATION_CREDENTIALS_JSON env vars');
    }
    const creds = JSON.parse(CREDS_JSON);
    sessionClient = new SessionsClient({
      projectId: DF_PROJECT_ID,
      credentials: {
        client_email: creds.client_email,
        private_key: creds.private_key,
      },
    });
  }
  return sessionClient;
}

function toChatfuelMessages(dfResponse) {
  const result = dfResponse.queryResult || {};
  const messages = [];

  // Prefer fulfillmentMessages if present
  if (Array.isArray(result.fulfillmentMessages) && result.fulfillmentMessages.length) {
    for (const m of result.fulfillmentMessages) {
      if (m.text && Array.isArray(m.text.text) && m.text.text.length) {
        messages.push({ text: m.text.text.join('\n') });
      }
      // Add mappings for cards / quick replies later if you use them in Dialogflow
    }
  } else if (result.fulfillmentText) {
    messages.push({ text: result.fulfillmentText });
  }

  if (!messages.length) messages.push({ text: '...' });
  return messages;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Use POST' });
    }

    // Optional simple auth
    if (BOT_SECRET) {
      if (req.headers['x-secret'] !== BOT_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { user_id, text, language_code } = req.body || {};
    if (!user_id || !text) {
      return res.status(400).json({ messages: [{ text: 'Missing user_id or text' }] });
    }

    const client = getClient();
    const sessionPath = client.projectAgentSessionPath(DF_PROJECT_ID, String(user_id));
    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: String(text),
          languageCode: language_code || 'en',
        },
      },
    };

    const [resp] = await client.detectIntent(request);
    const messages = toChatfuelMessages(resp);

    // Optional: expose matched intent name as a Chatfuel attribute
    const intentName = resp?.queryResult?.intent?.displayName || '';

    return res.status(200).json({
      messages,
      set_attributes: intentName ? { df_intent: intentName } : {},
    });
  } catch (err) {
    console.error(err);
    return res.status(200).json({
      messages: [{ text: 'Sorry—having trouble right now. Please try again.' }],
    });
  }
};
