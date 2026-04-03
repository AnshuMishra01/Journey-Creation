const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { runAutomation } = require('./playwright-automation');
const educationalRoutes = require('./src/routes/educationalRoutes');
const episodeRoutes = require('./src/routes/episodeRoutes');

const app = express();
const PORT = 3000;

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Educational routes (existing)
app.use('/api', educationalRoutes);

// Episode pipeline routes (new)
app.use('/api', episodeRoutes);

// Start workers in dev mode
if (process.env.ENABLE_WORKERS === 'true') {
  require('./worker');
}

// API to start automation
app.post('/api/start', async (req, res) => {
  const { context, journeyName, prompts, hostName, hostVoiceId, speakerName, speakerVoiceId, provider } = req.body;
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: 'Prompt list required.' });
  }
  if (!journeyName) {
    return res.status(400).json({ error: 'Journey name required.' });
  }
  
  console.log(`[Server] Starting automation with TTS provider: ${provider || 'default'}`);
  
  try {
    await runAutomation(prompts, context, journeyName, hostName, hostVoiceId, speakerName, speakerVoiceId);
    res.json({ status: 'completed', message: 'Automation completed successfully!' });
  } catch (e) {
    console.error('[Server] Automation error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
