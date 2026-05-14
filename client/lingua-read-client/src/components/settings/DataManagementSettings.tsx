import React from 'react';
import { Button, Form, Alert, Spinner, Row, Col } from 'react-bootstrap';

const DataManagementSettings = ({
  audioStorage,
  loadingStorage,
  storageError,
  isBackingUp,
  backupMessage,
  onBackupClick,
  restoreFile,
  isRestoring,
  restoreMessage,
  onRestoreFileChange,
  onRestoreClick,
  fileInputRef,
  isResettingStats,
  resetStatsMessage,
  onResetStatistics
}) => {
  return (
    <>
      <p className="text-muted small mb-3">Use these options with caution.</p>

      <div className="settings-control-group">
        <h6 className="fw-semibold mb-2">Audio Storage</h6>
        <p className="text-muted small mb-2">Total size of your audiobooks and audio lessons.</p>
        {loadingStorage && <Spinner animation="border" size="sm" />}
        {storageError && <Alert variant="danger" className="mt-2">{storageError}</Alert>}
        {audioStorage && !loadingStorage && (
          <Row>
            <Col md={6}>
              <strong>Total Size:</strong>{' '}
              {audioStorage.totalSizeGB > 0.1
                ? `${audioStorage.totalSizeGB} GB`
                : `${audioStorage.totalSizeMB} MB`}
            </Col>
            <Col md={6}>
              <strong>Total Files:</strong> {audioStorage.totalFiles}
            </Col>
            <Col xs={12}>
              <small className="text-muted mt-1 d-block">Maximum upload size per book: 5 GB</small>
            </Col>
          </Row>
        )}
      </div>

      <div className="settings-control-group">
        <h6 className="fw-semibold mb-2">Backup</h6>
        <p className="text-muted small mb-2">Download a full backup of the application database.</p>
        {backupMessage.text && <Alert variant={backupMessage.type} className="mt-2">{backupMessage.text}</Alert>}
        <Button variant="secondary" size="sm" onClick={onBackupClick} disabled={isBackingUp}>
          {isBackingUp ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              Backing up...
            </>
          ) : 'Download Backup'}
        </Button>
      </div>

      <div className="settings-control-group">
        <h6 className="fw-semibold mb-2">Restore</h6>
        <p className="text-danger small fw-bold mb-2">
          WARNING: Restoring from a backup will overwrite ALL current data. This action is irreversible.
        </p>
        <Form.Group controlId="restoreFile" className="mb-3">
          <Form.Label className="small">Select Backup File (.backup)</Form.Label>
          <Form.Control
            type="file"
            accept=".backup"
            onChange={onRestoreFileChange}
            ref={fileInputRef}
            disabled={isRestoring}
            size="sm"
          />
        </Form.Group>
        {restoreMessage.text && <Alert variant={restoreMessage.type} className="mt-2">{restoreMessage.text}</Alert>}
        <Button variant="danger" size="sm" onClick={onRestoreClick} disabled={isRestoring || !restoreFile}>
          {isRestoring ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              Restoring...
            </>
          ) : 'Restore from Backup'}
        </Button>
      </div>

      <div className="settings-control-group">
        <h6 className="fw-semibold mb-2">Reset Statistics</h6>
        <p className="text-warning small fw-bold mb-2">
          Reset all reading/listening history and aggregate counts. Your learned words, books, and texts will remain. This action is irreversible.
        </p>
        {resetStatsMessage.text && <Alert variant={resetStatsMessage.type} className="mt-2">{resetStatsMessage.text}</Alert>}
        <Button variant="warning" size="sm" onClick={onResetStatistics} disabled={isResettingStats}>
          {isResettingStats ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              Resetting...
            </>
          ) : 'Reset All Statistics'}
        </Button>
      </div>
    </>
  );
};

export default DataManagementSettings;
