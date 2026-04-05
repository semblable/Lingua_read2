import React from 'react';
import { Form, Button, Alert, Row, Col, Card } from 'react-bootstrap';

const DiscordSettings = ({
  settings,
  handleChange,
  onSetBrowserTimezone,
  reportPeriod,
  setReportPeriod,
  reportDays,
  setReportDays,
  isSendingReport,
  reportMessage,
  onSendReportNow
}) => {
  return (
    <>
      <div className="settings-control-group">
        <Form.Group className="mb-3" controlId="discordWeeklyReportEnabled">
          <Form.Check
            type="switch"
            name="discordWeeklyReportEnabled"
            label="Send me a weekly activity report on Discord"
            checked={settings.discordWeeklyReportEnabled}
            onChange={handleChange}
          />
        </Form.Group>

        <Form.Group className="mb-0" controlId="discordWebhookUrl">
          <Form.Label>Discord Webhook URL</Form.Label>
          <Form.Control
            type="url"
            name="discordWebhookUrl"
            autoComplete="off"
            placeholder="https://discord.com/api/webhooks/..."
            value={settings.discordWebhookUrl}
            onChange={handleChange}
          />
          <Form.Text className="text-muted">
            Create a webhook in your Discord channel settings and paste the URL here.
          </Form.Text>
        </Form.Group>
      </div>

      <div className="settings-control-group">
        <Row>
          <Col md={6}>
            <Form.Group className="mb-3" controlId="discordWeeklyReportDayOfWeek">
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
            <Form.Group className="mb-3" controlId="discordWeeklyReportHourLocal">
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

        <Form.Group className="mb-0" controlId="discordTimezoneOffsetMinutes">
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
            <Button variant="outline-secondary" size="sm" onClick={onSetBrowserTimezone}>
              Use browser timezone
            </Button>
          </div>
          <Form.Text className="text-muted">
            Example: UTC+2 is 120, UTC-5 is -300.
          </Form.Text>
        </Form.Group>
      </div>

      <div className="settings-control-group">
        <Card className="border-0" style={{ background: 'transparent' }}>
          <Card.Body className="px-0">
            <Card.Title as="h6" className="fw-semibold">Send Report Now</Card.Title>
            <Card.Text className="text-muted small">
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
              size="sm"
              onClick={onSendReportNow}
              disabled={isSendingReport || (reportPeriod === 'days' && (!reportDays || reportDays <= 0))}
            >
              {isSendingReport ? 'Sending...' : 'Send Report Now'}
            </Button>
          </Card.Body>
        </Card>
      </div>
    </>
  );
};

export default DiscordSettings;
