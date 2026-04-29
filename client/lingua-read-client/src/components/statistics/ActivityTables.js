import React from 'react';
import { Card, Col, Row, Table } from 'react-bootstrap';
import { formatDate } from '../../utils/helpers';
import { formatDuration } from '../../utils/statistics';

const ActivityTables = ({ readingActivity, listeningActivity }) => {
  const recentReading = (readingActivity.activityByDate || []).slice(-10).reverse();
  const listeningByLanguage = (listeningActivity.listeningByLanguage || [])
    .filter((item) => item.totalSeconds > 0)
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

  return (
    <Row className="mt-4 g-4">
      <Col lg={6}>
        <Card className="stats-card h-100 shadow-sm">
          <Card.Body>
            <Card.Title className="stats-eyebrow mb-4">Reading History</Card.Title>
            {recentReading.length > 0 ? (
              <div className="table-responsive">
                <Table borderless hover size="sm" className="mb-0">
                  <thead className="text-muted small text-uppercase">
                    <tr>
                      <th>Date</th>
                      <th className="text-end">Words Read</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentReading.map((item) => (
                      <tr key={item.date}>
                        <td className="text-muted">{formatDate(item.date)}</td>
                        <td className="text-end fw-bold">{item.wordsRead.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : (
              <div className="text-muted small">No reading activity in this period.</div>
            )}
          </Card.Body>
        </Card>
      </Col>

      <Col lg={6}>
        <Card className="stats-card h-100 shadow-sm">
          <Card.Body>
            <Card.Title className="stats-eyebrow mb-4">Listening by Language</Card.Title>
            {listeningByLanguage.length > 0 ? (
              <div className="table-responsive">
                <Table borderless hover size="sm" className="mb-0">
                  <thead className="text-muted small text-uppercase">
                    <tr>
                      <th>Language</th>
                      <th className="text-end">Total Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listeningByLanguage.map((item) => (
                      <tr key={item.languageId || item.languageName}>
                        <td className="text-muted">{item.languageName}</td>
                        <td className="text-end fw-bold">{formatDuration(item.totalSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : (
              <div className="text-muted small">No listening activity in this period.</div>
            )}
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
};

export default ActivityTables;

