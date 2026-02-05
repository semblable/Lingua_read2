import React, { useEffect } from 'react';
import { Container, Row, Col, Card, Button, Spinner, Alert, Tabs, Tab } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useTextsStore } from '../../utils/store';
import { getTexts, completeText } from '../../utils/api';

const TextList = () => {
  const { texts, loading, error, setTexts, setLoading, setError } = useTextsStore();

  useEffect(() => {
    const fetchTexts = async () => {
      setLoading(true);
      try {
        const data = await getTexts();
        setTexts(data);
      } catch (err) {
        setError(err.message || 'Failed to load texts');
      } finally {
        setLoading(false);
      }
    };

    fetchTexts();
  }, [setTexts, setLoading, setError]);

  const [activeTab, setActiveTab] = React.useState('active');

  const handleMarkFinished = async (textId) => {
    if (!window.confirm("Mark this text as finished?")) return;
    try {
      await completeText(textId);
      const data = await getTexts();
      setTexts(data);
    } catch (err) {
      alert("Failed. " + (err.message || ""));
    }
  };

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </Container>
    );
  }

  const activeTexts = texts.filter(t => !t.isFinished);
  const finishedTexts = texts.filter(t => t.isFinished);
  const displayTexts = activeTab === 'finished' ? finishedTexts : activeTexts;

  return (
    <Container className="py-5">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1>My Texts</h1>
        <Button as={Link} to="/texts/create" variant="success">
          Add New Text
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Tabs
        id="text-tabs"
        activeKey={activeTab}
        onSelect={(k) => setActiveTab(k)}
        className="mb-4"
      >
        <Tab eventKey="active" title={`Active (${activeTexts.length})`}>
          {activeTexts.length === 0 ? (
            <Card className="text-center p-5">
              <Card.Body>
                <h3>No active texts</h3>
                <p className="mb-4">Add a new text or check your finished archive.</p>
                <Button as={Link} to="/texts/create" variant="primary">
                  Add New Text
                </Button>
              </Card.Body>
            </Card>
          ) : (
            <Row>
              {activeTexts.map((text) => (
                <TextListCard
                  key={text.textId || text.id}
                  text={text}
                  onMarkFinished={handleMarkFinished}
                />
              ))}
            </Row>
          )}
        </Tab>
        <Tab eventKey="finished" title={`Finished (${finishedTexts.length})`}>
          {finishedTexts.length === 0 ? (
            <Card className="text-center p-5">
              <Card.Body>
                <h3>No finished texts yet</h3>
                <p className="mb-4">Keep reading/listening to complete your lessons!</p>
              </Card.Body>
            </Card>
          ) : (
            <Row>
              {finishedTexts.map((text) => (
                <TextListCard key={text.textId || text.id} text={text} />
              ))}
            </Row>
          )}
        </Tab>
      </Tabs>
    </Container>
  );
};

const TextListCard = ({ text, onMarkFinished }) => (
  <Col md={4} className="mb-4">
    <Card className="h-100 text-card shadow-sm position-relative">
      {text.isFinished && (
        <span className="position-absolute top-0 end-0 m-2 badge bg-success">Finished</span>
      )}
      <Card.Body>
        <Card.Title>{text.title}</Card.Title>
        <Card.Subtitle className="mb-2 text-muted">
          {text.languageName || text.language?.name}
        </Card.Subtitle>
        <Card.Text>
          {text.content ? text.content.substring(0, 100) + '...' : (text.tag ? `Tag: ${text.tag}` : '')}
        </Card.Text>

        {text.isAudioLesson && text.audioProgress > 0 && (
          <div className="mb-2">
            <div className="progress" style={{ height: '5px' }}>
              <div
                className="progress-bar bg-info"
                role="progressbar"
                style={{ width: `${Math.min(text.audioProgress * 100, 100)}%` }}
                aria-valuenow={text.audioProgress * 100}
                aria-valuemin="0"
                aria-valuemax="100"
              ></div>
            </div>
            <small className="text-muted">{Math.round(text.audioProgress * 100)}% listened</small>
          </div>
        )}

        <div className="mt-3">
          <small className="text-muted">
            Words: {text.wordCount || 'N/A'} |
            Learning: {text.learningWords || 0} |
            Known: {text.knownWords || 0}
          </small>
        </div>
      </Card.Body>
      <Card.Footer className="bg-white border-top-0">
        <Button
          as={Link}
          to={`/texts/${text.textId || text.id}`}
          variant="outline-primary"
          className="w-100 mb-2"
        >
          {text.isFinished ? 'Review' : 'Continue Reading'}
        </Button>
        {!text.isFinished && onMarkFinished && (
          <Button
            variant="outline-success"
            size="sm"
            className="w-100"
            onClick={() => onMarkFinished(text.textId || text.id)}
          >
            Mark as Finished
          </Button>
        )}
      </Card.Footer>
    </Card>
  </Col>
);

export default TextList; 