import React from 'react';
import { Col, Row } from 'react-bootstrap';
import ContinueLearningCard from './ContinueLearningCard';
import MoreToResumeList from './MoreToResumeList';
import type { RecentTexts } from '../../utils/api/texts';

interface ContinueLearningSectionProps {
  texts: RecentTexts;
  loading?: boolean;
  maxSecondary?: number;
}

const ContinueLearningSection: React.FC<ContinueLearningSectionProps> = ({
  texts,
  loading,
  maxSecondary = 5,
}) => {
  const primary = texts && texts.length > 0 ? texts[0] : null;
  const secondary = texts ? texts.slice(1, 1 + maxSecondary) : [];
  const hasSecondary = secondary.length > 0;

  return (
    <Row className="g-3 mb-4">
      <Col xs={12} lg={hasSecondary ? 8 : 12}>
        <ContinueLearningCard text={primary} loading={loading} />
      </Col>
      {hasSecondary && (
        <Col xs={12} lg={4}>
          <MoreToResumeList texts={secondary} />
        </Col>
      )}
    </Row>
  );
};

export default ContinueLearningSection;
