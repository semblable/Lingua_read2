import React, { useState, useEffect, useRef, useContext } from 'react'; // Added useRef, useContext
import { Container, Card, Form, Button, Alert, Spinner, Row, Col } from 'react-bootstrap';
import {
  getUserSettings, updateUserSettings, getAllLanguages, // Changed getLanguages to getAllLanguages
  backupDatabase, restoreDatabase, resetUserStatistics, sendDiscordReport, getAudioStorageSize // Import new API functions
} from '../utils/api';
import * as api from '../utils/api'; // Import api object for test button
import { SettingsContext } from '../contexts/SettingsContext'; // Import SettingsContext
const UserSettings = () => {
  const browserTimezoneOffsetMinutes = -new Date().getTimezoneOffset();
  const [settings, setSettings] = useState({
    theme: 'dark',
    textSize: 16,
    textFont: 'default',
    leftPanelWidth: 85, // Added initial state
    autoTranslateWords: true,
    pauseOnWordClick: false,
    highlightKnownWords: true,
    defaultLanguageId: 0,
    autoAdvanceToNextLesson: false,
    autoMoveFinishedLessons: false, // Added property
    showProgressStats: true,
    lineSpacing: 1.5, // Added lineSpacing setting
    discordWeeklyReportEnabled: false,
    discordWebhookUrl: '',
    discordWeeklyReportDayOfWeek: 'Monday',
    discordWeeklyReportHourLocal: 8,
    discordTimezoneOffsetMinutes: browserTimezoneOffsetMinutes,
    useOpenRouter: false,
    openRouterApiKey: '',
    openRouterModel: 'google/gemini-2.5-flash-preview-05-20:free'
  });

  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loadingLanguages, setLoadingLanguages] = useState(true);

  // --- State for Backup/Restore ---
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupMessage, setBackupMessage] = useState({ type: '', text: '' });
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState({ type: '', text: '' });
  const [restoreFile, setRestoreFile] = useState(null);
  const fileInputRef = useRef(null); // Ref for file input
  const [isResettingStats, setIsResettingStats] = useState(false);
  const [resetStatsMessage, setResetStatsMessage] = useState({ type: '', text: '' });
  // --- End Backup/Restore State ---

  // --- Discord Report State ---
  const [reportPeriod, setReportPeriod] = useState('week');
  const [reportDays, setReportDays] = useState(30);
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [reportMessage, setReportMessage] = useState({ type: '', text: '' });
  // --- End Discord Report State ---

  // --- OpenRouter Test State ---
  const [testingOpenRouter, setTestingOpenRouter] = useState(false);
  const [openRouterTestResult, setOpenRouterTestResult] = useState(null);
  // --- End OpenRouter Test State ---

  // --- Audio Storage State ---
  const [audioStorage, setAudioStorage] = useState(null);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [storageError, setStorageError] = useState('');
  // --- End Audio Storage State ---

  // Removed unused isAdmin placeholder

  // Get updateSetting function from context
  const { updateSetting } = useContext(SettingsContext);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await getUserSettings();
        setSettings({
          theme: data.theme || 'dark',
          textSize: data.textSize || 16,
          textFont: data.textFont || 'default',
          leftPanelWidth: data.leftPanelWidth || 85, // Fetch panel width
          autoTranslateWords: data.autoTranslateWords ?? true,
          pauseOnWordClick: data.pauseOnWordClick ?? false,
          highlightKnownWords: data.highlightKnownWords ?? true,
          defaultLanguageId: data.defaultLanguageId || 0,
          autoAdvanceToNextLesson: data.autoAdvanceToNextLesson ?? false,
          autoMoveFinishedLessons: data.autoMoveFinishedLessons ?? false, // Map response
          showProgressStats: data.showProgressStats ?? true,
          lineSpacing: data.lineSpacing || 1.5, // Fetch lineSpacing
          discordWeeklyReportEnabled: data.discordWeeklyReportEnabled ?? false,
          discordWebhookUrl: data.discordWebhookUrl || '',
          discordWeeklyReportDayOfWeek: data.discordWeeklyReportDayOfWeek || 'Monday',
          discordWeeklyReportHourLocal: data.discordWeeklyReportHourLocal ?? 8,
          discordTimezoneOffsetMinutes: data.discordTimezoneOffsetMinutes ?? browserTimezoneOffsetMinutes,
          useOpenRouter: data.useOpenRouter ?? false,
          openRouterApiKey: data.openRouterApiKey || '',
          openRouterModel: data.openRouterModel || 'google/gemini-2.5-flash-preview-05-20:free'
        });
      } catch (err) {
        setError('Failed to load settings. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    const fetchLanguages = async () => {
      try {
        const data = await getAllLanguages(); // Use getAllLanguages
        setLanguages(data || []); // Ensure it's an array
      } catch (err) {
        console.error('Failed to load languages:', err);
      } finally {
        setLoadingLanguages(false);
      }
    };

    const fetchStorageSize = async () => {
      setLoadingStorage(true);
      try {
        const data = await getAudioStorageSize();
        setAudioStorage(data);
      } catch (err) {
        console.error('Failed to load audio storage size:', err);
        setStorageError('Failed to load storage information');
      } finally {
        setLoadingStorage(false);
      }
    };

    fetchSettings();
    fetchLanguages();
    fetchStorageSize();
  }, [browserTimezoneOffsetMinutes]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    let processedValue = value;
    if (type === 'checkbox') {
      processedValue = checked;
    } else if (
      type === 'number' ||
      type === 'range' ||
      name === 'textSize' ||
      name === 'leftPanelWidth' ||
      name === 'lineSpacing' ||
      name === 'defaultLanguageId' ||
      name === 'discordWeeklyReportHourLocal' ||
      name === 'discordTimezoneOffsetMinutes'
    ) { // Treat these fields as numbers
      if (name === 'lineSpacing') {
        processedValue = parseFloat(value);
      } else {
        processedValue = parseInt(value, 10);
      }
      if (isNaN(processedValue)) { // Handle potential NaN if parsing fails (e.g., for "0")
        processedValue = 0; // Default to 0 if parsing fails or value is "0"
      }
    }

    setSettings(prevSettings => ({
      ...prevSettings,
      [name]: processedValue
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);

    try {
      await updateUserSettings(settings);

      // Apply theme change immediately and save to localStorage
      localStorage.setItem('theme', settings.theme);
      document.body.classList.remove('light-theme', 'dark-theme', 'classic-dark-theme'); // Clear existing theme classes

      if (settings.theme === 'dark') {
        document.body.classList.add('dark-theme');
      } else if (settings.theme === 'light') {
        document.body.classList.add('light-theme');
      } else if (settings.theme === 'classic-dark') {
        document.body.classList.add('classic-dark-theme');
      } else { // System theme (defaults to light/dark based on system)
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
          document.body.classList.add('dark-theme'); // Or classic-dark-theme if preferred for system dark
        } else {
          document.body.classList.add('light-theme');
        }
      }

      // Update global context after successful API save
      updateSetting('theme', settings.theme);
      localStorage.setItem('theme', settings.theme); // Ensure theme is saved here too

      updateSetting('textSize', settings.textSize);
      localStorage.setItem('textSize', settings.textSize.toString());

      updateSetting('textFont', settings.textFont);
      localStorage.setItem('textFont', settings.textFont);

      updateSetting('leftPanelWidth', settings.leftPanelWidth);
      localStorage.setItem('leftPanelWidth', settings.leftPanelWidth.toString());

      updateSetting('autoTranslateWords', settings.autoTranslateWords);
      localStorage.setItem('autoTranslateWords', settings.autoTranslateWords.toString());

      updateSetting('pauseOnWordClick', settings.pauseOnWordClick);
      localStorage.setItem('pauseOnWordClick', settings.pauseOnWordClick.toString());

      updateSetting('highlightKnownWords', settings.highlightKnownWords);
      localStorage.setItem('highlightKnownWords', settings.highlightKnownWords.toString());

      updateSetting('defaultLanguageId', settings.defaultLanguageId);
      localStorage.setItem('defaultLanguageId', settings.defaultLanguageId.toString());

      updateSetting('autoAdvanceToNextLesson', settings.autoAdvanceToNextLesson);
      localStorage.setItem('autoAdvanceToNextLesson', settings.autoAdvanceToNextLesson.toString());

      updateSetting('autoMoveFinishedLessons', settings.autoMoveFinishedLessons);
      localStorage.setItem('autoMoveFinishedLessons', settings.autoMoveFinishedLessons.toString());

      updateSetting('showProgressStats', settings.showProgressStats);
      localStorage.setItem('showProgressStats', settings.showProgressStats.toString());

      updateSetting('lineSpacing', settings.lineSpacing); // Update context for lineSpacing
      localStorage.setItem('lineSpacing', settings.lineSpacing.toString()); // Save lineSpacing to localStorage

      updateSetting('discordWeeklyReportEnabled', settings.discordWeeklyReportEnabled);
      localStorage.setItem('discordWeeklyReportEnabled', settings.discordWeeklyReportEnabled.toString());

      updateSetting('discordWebhookUrl', settings.discordWebhookUrl);
      localStorage.setItem('discordWebhookUrl', settings.discordWebhookUrl || '');

      updateSetting('discordWeeklyReportDayOfWeek', settings.discordWeeklyReportDayOfWeek);
      localStorage.setItem('discordWeeklyReportDayOfWeek', settings.discordWeeklyReportDayOfWeek);

      updateSetting('discordWeeklyReportHourLocal', settings.discordWeeklyReportHourLocal);
      localStorage.setItem('discordWeeklyReportHourLocal', settings.discordWeeklyReportHourLocal.toString());

      updateSetting('discordTimezoneOffsetMinutes', settings.discordTimezoneOffsetMinutes);
      localStorage.setItem('discordTimezoneOffsetMinutes', settings.discordTimezoneOffsetMinutes.toString());

      setSuccess(true);
      // Hide success message after 3 seconds
      setTimeout(() => {
        setSuccess(false);
      }, 3000);
    } catch (err) {
      setError(err.message || 'Failed to update settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSendReportNow = async () => {
    setIsSendingReport(true);
    setReportMessage({ type: '', text: '' });
    try {
      const result = await sendDiscordReport(reportPeriod, reportPeriod === 'days' ? reportDays : null);
      setReportMessage({ type: 'success', text: result.message || 'Report sent.' });
    } catch (err) {
      setReportMessage({ type: 'danger', text: err.message || 'Failed to send report.' });
    } finally {
      setIsSendingReport(false);
    }
  };

  const handleSetBrowserTimezone = () => {
    const offsetMinutes = -new Date().getTimezoneOffset();
    setSettings(prevSettings => ({
      ...prevSettings,
      discordTimezoneOffsetMinutes: offsetMinutes
    }));
  };

  // --- Backup/Restore Handlers ---
  const handleBackupClick = async () => {
    setIsBackingUp(true);
    setBackupMessage({ type: '', text: '' });
    try {
      const result = await backupDatabase();
      setBackupMessage({ type: 'success', text: result.message || 'Backup download started.' });
      // Clear message after a few seconds
      setTimeout(() => setBackupMessage({ type: '', text: '' }), 5000);
    } catch (err) {
      console.error("Backup failed:", err);
      setBackupMessage({ type: 'danger', text: `Backup failed: ${err.message}` });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setRestoreFile(e.target.files[0]);
      setRestoreMessage({ type: '', text: '' }); // Clear previous messages
    } else {
      setRestoreFile(null);
    }
  };

  const handleRestoreClick = async () => {
    if (!restoreFile) {
      setRestoreMessage({ type: 'warning', text: 'Please select a backup file to restore.' });
      return;
    }

    const confirmation = window.confirm(
      "WARNING: Restoring from this backup will completely overwrite the current database.\n\n" +
      "All data added since this backup was created WILL BE LOST.\n\n" +
      "This action is IRREVERSIBLE.\n\n" +
      "Are you absolutely sure you want to proceed?"
    );

    if (!confirmation) {
      setRestoreMessage({ type: 'info', text: 'Restore cancelled.' });
      return;
    }

    setIsRestoring(true);
    setRestoreMessage({ type: '', text: '' });

    try {
      const result = await restoreDatabase(restoreFile);
      setRestoreMessage({ type: 'success', text: result.message || 'Database restored successfully. Please refresh or restart the application.' });
      setRestoreFile(null); // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''; // Reset file input visually
      }
    } catch (err) {
      console.error("Restore failed:", err);
      setRestoreMessage({ type: 'danger', text: `Restore failed: ${err.message}` });
    } finally {
      setIsRestoring(false);
    }
  };
  // --- End Backup/Restore Handlers ---

  // --- Reset Statistics Handler ---
  const handleResetStatistics = async () => {
    const confirmation = window.confirm(
      "Are you sure you want to reset all your reading and listening statistics?\n\n" +
      "This includes activity history, words read counts, listening time, etc.\n\n" +
      "Your account, books, texts, and learned word statuses will NOT be affected.\n\n" +
      "This action cannot be undone."
    );

    if (!confirmation) {
      setResetStatsMessage({ type: 'info', text: 'Statistics reset cancelled.' });
      return;
    }

    setIsResettingStats(true);
    setResetStatsMessage({ type: '', text: '' });

    try {
      const result = await resetUserStatistics();
      setResetStatsMessage({ type: 'success', text: result.message || 'Statistics reset successfully.' });
      // Optionally clear message after a few seconds
      setTimeout(() => setResetStatsMessage({ type: '', text: '' }), 5000);
    } catch (err) {
      console.error("Reset statistics failed:", err);
      setResetStatsMessage({ type: 'danger', text: `Reset failed: ${err.message}` });
    } finally {
      setIsResettingStats(false);
    }
  };
  // --- End Reset Statistics Handler ---


  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading settings...</span>
        </Spinner>
      </Container>
    );
  }

  return (
    <Container className="py-5">
      <Card className="shadow-sm">
        <Card.Body className="p-4">
          <h2 className="mb-4">User Settings</h2>

          {error && <Alert variant="danger">{error}</Alert>}
          {success && <Alert variant="success">Settings updated successfully!</Alert>}

          <Form onSubmit={handleSubmit}>
            {/* --- Existing UI Preferences --- */}
            <h4 className="mt-4 mb-3">UI Preferences</h4>
            {/* ... (theme, text size, font) ... */}
            <Row className="mb-3">
              <Col md={6}>
                <Form.Group controlId="theme">
                  <Form.Label>Theme</Form.Label>
                  <Form.Select
                    name="theme"
                    value={settings.theme}
                    onChange={handleChange}
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="classic-dark">Classic Dark</option>
                    <option value="system">System Default</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group controlId="textSize">
                  <Form.Label>Text Size ({settings.textSize}px)</Form.Label>
                  <Form.Range
                    name="textSize"
                    min={10}
                    max={36}
                    value={settings.textSize}
                    onChange={handleChange}
                  />
                  <div className="d-flex justify-content-between">
                    <small>Small</small>
                    <small>Large</small>
                  </div>
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-4" controlId="textFont">
              <Form.Label>Font Family</Form.Label>
              <Form.Select
                name="textFont"
                value={settings.textFont}
                onChange={handleChange}
              >
                <option value="default">Default (Inter)</option>
                <option value="serif">Serif (Lora)</option>
                <option value="open-sans">Open Sans</option>
                <option value="lato">Lato</option>
                <option value="atkinson">Atkinson Hyperlegible</option>
                <option value="merriweather">Merriweather</option>
                <option value="roboto-slab">Roboto Slab</option>
                <option value="monospace">Monospace</option>
                <option value="comic-sans">Comic Sans</option>
                <option value="dyslexic">OpenDyslexic</option>
              </Form.Select>
            </Form.Group>

            {/* Added Left Panel Width Slider */}
            <Form.Group className="mb-4" controlId="leftPanelWidth">
              <Form.Label>Reading Panel Width ({settings.leftPanelWidth}%)</Form.Label>
              <Form.Range
                name="leftPanelWidth"
                min={20}
                max={85} // Increased max width to 85%
                value={settings.leftPanelWidth}
                onChange={handleChange}
              />
              <div className="d-flex justify-content-between">
                <small>Narrow</small>
                <small>Wide</small>
              </div>
            </Form.Group>

            <Form.Group className="mb-4" controlId="lineSpacing">
              <Form.Label>Line Spacing</Form.Label>
              <Form.Select
                name="lineSpacing"
                value={settings.lineSpacing}
                onChange={handleChange}
              >
                <option value={1.5}>Default</option>
                <option value={1.75}>Relaxed</option>
                <option value={2.0}>Spacious</option>
              </Form.Select>
            </Form.Group>


            {/* --- Existing Reading Preferences --- */}
            <h4 className="mt-4 mb-3">Reading Preferences</h4>
            {/* ... (auto translate, highlight, default language) ... */}
            <Form.Group className="mb-3" controlId="autoTranslateWords">
              <Form.Check
                type="checkbox"
                name="autoTranslateWords"
                label="Automatically translate words when clicked"
                checked={settings.autoTranslateWords}
                onChange={handleChange}
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="pauseOnWordClick">
              <Form.Check
                type="checkbox"
                name="pauseOnWordClick"
                label="Pause audio when a word or phrase is opened"
                checked={settings.pauseOnWordClick}
                onChange={handleChange}
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="highlightKnownWords">
              <Form.Check
                type="checkbox"
                name="highlightKnownWords"
                label="Highlight words based on knowledge level"
                checked={settings.highlightKnownWords}
                onChange={handleChange}
              />
            </Form.Group>

            <Form.Group className="mb-4" controlId="defaultLanguageId">
              <Form.Label>Default Language for New Texts</Form.Label>
              <Form.Select
                name="defaultLanguageId"
                value={settings.defaultLanguageId}
                onChange={handleChange}
                disabled={loadingLanguages}
              >
                <option value={0}>No default (ask each time)</option>
                {languages.map(language => (
                  <option key={language.languageId} value={language.languageId}>
                    {language.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>


            {/* --- Existing Navigation Preferences --- */}
            <h4 className="mt-4 mb-3">Navigation Preferences</h4>
            {/* ... (auto advance, show stats) ... */}
            <Form.Group className="mb-3" controlId="autoAdvanceToNextLesson">
              <Form.Check
                type="checkbox"
                name="autoAdvanceToNextLesson"
                label="Automatically advance to next lesson after completion"
                checked={settings.autoAdvanceToNextLesson}
                onChange={handleChange}
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="autoMoveFinishedLessons">
              <Form.Check
                type="checkbox"
                name="autoMoveFinishedLessons"
                label="Automatically move finished lessons to 'Finished' folder"
                checked={settings.autoMoveFinishedLessons || false}
                onChange={handleChange}
              />
            </Form.Group>

            <Form.Group className="mb-4" controlId="showProgressStats">
              <Form.Check
                type="checkbox"
                name="showProgressStats"
                label="Show progress statistics after completing a lesson"
                checked={settings.showProgressStats}
                onChange={handleChange}
              />
            </Form.Group>

            {/* --- AI Provider Settings --- */}
            <h4 className="mt-4 mb-3">AI Provider</h4>
            <Form.Group className="mb-3" controlId="useOpenRouter">
              <Form.Check
                type="checkbox"
                name="useOpenRouter"
                label="Use OpenRouter instead of Gemini for translation and story generation"
                checked={settings.useOpenRouter}
                onChange={handleChange}
              />
              <Form.Text muted>
                OpenRouter provides access to multiple AI models. You'll need an API key from openrouter.ai.
              </Form.Text>
            </Form.Group>

            {settings.useOpenRouter && (
              <>
                <Form.Group className="mb-3" controlId="openRouterApiKey">
                  <Form.Label>OpenRouter API Key</Form.Label>
                  <Form.Control
                    type="password"
                    name="openRouterApiKey"
                    placeholder="sk-or-..."
                    value={settings.openRouterApiKey}
                    onChange={handleChange}
                  />
                  <Form.Text muted>
                    Get your API key from <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">openrouter.ai/keys</a>
                  </Form.Text>
                </Form.Group>

                <Form.Group className="mb-3" controlId="openRouterModel">
                  <Form.Label>Model Name</Form.Label>
                  <Form.Control
                    type="text"
                    name="openRouterModel"
                    placeholder="google/gemini-2.5-flash-preview-05-20:free"
                    value={settings.openRouterModel}
                    onChange={handleChange}
                  />
                  <Form.Text muted>
                    Paste any model name from <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">openrouter.ai/models</a>.
                    Free models end with ":free".
                  </Form.Text>
                </Form.Group>

                <div className="mb-4">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={async () => {
                      setTestingOpenRouter(true);
                      setOpenRouterTestResult(null);
                      try {
                        // First save current settings
                        await api.updateUserSettings(settings);
                        // Then test
                        const result = await api.testOpenRouterConnection();
                        setOpenRouterTestResult(result);
                      } catch (err) {
                        setOpenRouterTestResult({ success: false, message: err.message });
                      } finally {
                        setTestingOpenRouter(false);
                      }
                    }}
                    disabled={testingOpenRouter || !settings.openRouterApiKey}
                  >
                    {testingOpenRouter ? 'Testing...' : 'Test Connection'}
                  </Button>
                  {openRouterTestResult && (
                    <Alert
                      variant={openRouterTestResult.success ? 'success' : 'danger'}
                      className="mt-2 mb-0"
                      style={{ fontSize: '0.9em' }}
                    >
                      <strong>{openRouterTestResult.success ? '✓' : '✗'}</strong> {openRouterTestResult.message}
                      {openRouterTestResult.details && (
                        <div className="mt-1" style={{ fontSize: '0.85em', opacity: 0.8 }}>
                          {openRouterTestResult.details.substring(0, 200)}
                        </div>
                      )}
                    </Alert>
                  )}
                </div>
              </>
            )}

            {/* --- Discord Reports --- */}
            <h4 className="mt-4 mb-3">Discord Reports</h4>
            <Form.Group className="mb-3" controlId="discordWeeklyReportEnabled">
              <Form.Check
                type="checkbox"
                name="discordWeeklyReportEnabled"
                label="Send me a weekly activity report on Discord"
                checked={settings.discordWeeklyReportEnabled}
                onChange={handleChange}
              />
            </Form.Group>
            <Form.Group className="mb-4" controlId="discordWebhookUrl">
              <Form.Label>Discord Webhook URL</Form.Label>
              <Form.Control
                type="url"
                name="discordWebhookUrl"
                placeholder="https://discord.com/api/webhooks/..."
                value={settings.discordWebhookUrl}
                onChange={handleChange}
              />
              <Form.Text muted>
                Create a webhook in your Discord channel settings and paste the URL here.
              </Form.Text>
            </Form.Group>
            <Row className="mb-3">
              <Col md={6}>
                <Form.Group controlId="discordWeeklyReportDayOfWeek">
                  <Form.Label>Report Day</Form.Label>
                  <Form.Select
                    name="discordWeeklyReportDayOfWeek"
                    value={settings.discordWeeklyReportDayOfWeek}
                    onChange={handleChange}
                  >
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                    <option value="Sunday">Sunday</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="discordWeeklyReportHourLocal">
                  <Form.Label>Report Hour (Local)</Form.Label>
                  <Form.Select
                    name="discordWeeklyReportHourLocal"
                    value={settings.discordWeeklyReportHourLocal}
                    onChange={handleChange}
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>
                        {hour.toString().padStart(2, '0')}:00
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-4" controlId="discordTimezoneOffsetMinutes">
              <Form.Label>Timezone Offset (minutes from UTC)</Form.Label>
              <Form.Control
                type="number"
                name="discordTimezoneOffsetMinutes"
                value={settings.discordTimezoneOffsetMinutes}
                onChange={handleChange}
                min={-840}
                max={840}
              />
              <div className="mt-2">
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={handleSetBrowserTimezone}
                >
                  Use browser timezone
                </Button>
              </div>
              <Form.Text muted>
                Example: UTC+2 is 120, UTC-5 is -300.
              </Form.Text>
            </Form.Group>

            <Card className="mb-4">
              <Card.Body>
                <Card.Title>Send Report Now</Card.Title>
                <Card.Text className="text-muted">
                  Send an activity report immediately using your selected timeframe.
                </Card.Text>
                {reportMessage.text && (
                  <Alert variant={reportMessage.type} className="mt-2">
                    {reportMessage.text}
                  </Alert>
                )}
                <Row className="mb-3">
                  <Col md={6}>
                    <Form.Group controlId="reportPeriod">
                      <Form.Label>Report Period</Form.Label>
                      <Form.Select
                        value={reportPeriod}
                        onChange={(e) => setReportPeriod(e.target.value)}
                      >
                        <option value="week">Last 7 days</option>
                        <option value="month">Last 30 days</option>
                        <option value="year">Last 365 days</option>
                        <option value="all">All time</option>
                        <option value="days">Custom days</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group controlId="reportDays">
                      <Form.Label>Custom Days</Form.Label>
                      <Form.Control
                        type="number"
                        min={1}
                        max={3650}
                        value={reportDays}
                        disabled={reportPeriod !== 'days'}
                        onChange={(e) => setReportDays(parseInt(e.target.value, 10) || 1)}
                      />
                    </Form.Group>
                  </Col>
                </Row>
                <Button
                  variant="primary"
                  onClick={handleSendReportNow}
                  disabled={isSendingReport || (reportPeriod === 'days' && (!reportDays || reportDays <= 0))}
                >
                  {isSendingReport ? 'Sending...' : 'Send Report Now'}
                </Button>
              </Card.Body>
            </Card>


            <div className="d-grid gap-2 mb-4"> {/* Added mb-4 */}
              <Button
                variant="primary"
                type="submit"
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Saving...
                  </>
                ) : 'Save Settings'}
              </Button>
            </div>
          </Form>

          {/* --- Data Management Section --- */}
          {/* Removed isAdmin check to make available to all users */}
          <>
            <hr />
            <h4 className="mt-4 mb-3">Data Management</h4> {/* Renamed Header */}
            <p className="text-muted small">Use these options with caution.</p>

            {/* Audio Storage Section */}
            <Card className="mb-3">
              <Card.Body>
                <Card.Title>Audio Storage</Card.Title>
                <Card.Text>Total size of your audiobooks and audio lessons.</Card.Text>
                {loadingStorage && <Spinner animation="border" size="sm" />}
                {storageError && <Alert variant="danger" className="mt-2">{storageError}</Alert>}
                {audioStorage && !loadingStorage && (
                  <div className="mt-2">
                    <Row>
                      <Col md={6}>
                        <strong>Total Size:</strong> {audioStorage.totalSizeGB > 0.1
                          ? `${audioStorage.totalSizeGB} GB`
                          : `${audioStorage.totalSizeMB} MB`}
                      </Col>
                      <Col md={6}>
                        <strong>Total Files:</strong> {audioStorage.totalFiles}
                      </Col>
                    </Row>
                    <div className="mt-2">
                      <small className="text-muted">
                        Maximum upload size per book: 5 GB
                      </small>
                    </div>
                  </div>
                )}
              </Card.Body>
            </Card>

            {/* Backup Section */}
            <Card className="mb-3">
              <Card.Body>
                <Card.Title>Backup</Card.Title>
                <Card.Text>Download a full backup of the application database.</Card.Text>
                {backupMessage.text && <Alert variant={backupMessage.type} className="mt-2">{backupMessage.text}</Alert>}
                <Button
                  variant="secondary"
                  onClick={handleBackupClick}
                  disabled={isBackingUp}
                >
                  {isBackingUp ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Backing up...
                    </>
                  ) : 'Download Backup'}
                </Button>
              </Card.Body>
            </Card>

            {/* Restore Section */}
            <Card>
              <Card.Body>
                <Card.Title>Restore</Card.Title>
                <Card.Text className="text-danger fw-bold">
                  WARNING: Restoring from a backup will overwrite ALL current data. This action is irreversible.
                </Card.Text>
                <Form.Group controlId="restoreFile" className="mb-3">
                  <Form.Label>Select Backup File (.backup)</Form.Label>
                  <Form.Control
                    type="file"
                    accept=".backup" // Suggest correct file type
                    onChange={handleRestoreFileChange}
                    ref={fileInputRef} // Assign ref
                    disabled={isRestoring}
                  />
                </Form.Group>
                {restoreMessage.text && <Alert variant={restoreMessage.type} className="mt-2">{restoreMessage.text}</Alert>}
                <Button
                  variant="danger"
                  onClick={handleRestoreClick}
                  disabled={isRestoring || !restoreFile}
                >
                  {isRestoring ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Restoring...
                    </>
                  ) : 'Restore from Backup'}
                </Button>
              </Card.Body>
            </Card>

            {/* Reset Statistics Section */}
            <Card className="mt-3">
              <Card.Body>
                <Card.Title>Reset Statistics</Card.Title>
                <Card.Text className="text-warning fw-bold">
                  Reset all reading/listening history and aggregate counts (words read, time listened, texts/books completed). Your learned words status, books, and texts themselves will remain. This action is irreversible.
                </Card.Text>
                {resetStatsMessage.text && <Alert variant={resetStatsMessage.type} className="mt-2">{resetStatsMessage.text}</Alert>}
                <Button
                  variant="warning" // Use warning color for caution
                  onClick={handleResetStatistics}
                  disabled={isResettingStats}
                >
                  {isResettingStats ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Resetting...
                    </>
                  ) : 'Reset All Statistics'}
                </Button>
              </Card.Body>
            </Card>
          </>
          {/* --- End Data Management Section --- */} {/* Updated comment */}

        </Card.Body>
      </Card>
    </Container>
  );
};

export default UserSettings;