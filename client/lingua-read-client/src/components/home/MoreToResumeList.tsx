import React from 'react';
import { Card, ProgressBar } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import type { RecentTexts } from '../../utils/api/texts';
import { relativeTime, resumeSummary, resumeTitle } from './resumeSummary';

const MoreToResumeList: React.FC<{ texts: RecentTexts }> = ({ texts }) => {
  if (!texts?.length) return null;
  return (
    <Card className="home-resume-list" data-testid="more-to-resume">
      <Card.Body>
        <div className="home-section-heading"><h2>Recently opened</h2><Link to="/library">View library <i className="bi bi-chevron-right" aria-hidden="true" /></Link></div>
        <div className="home-shelf-items">
          {texts.map(text => {
            const summary = resumeSummary(text);
            const when = relativeTime(text.lastAccessedAt);
            return (
              <Link to={`/texts/${text.textId}`} key={text.textId} className="home-shelf-item" data-testid="more-to-resume-item">
                <span className="home-shelf-icon" aria-hidden="true"><i className={`bi bi-${text.isAudioLesson ? 'headphones' : 'book'}`} /></span>
                <div className="home-shelf-copy">
                  <div className="home-shelf-title"><strong title={resumeTitle(text)}>{resumeTitle(text)}</strong><span className="home-format">{text.isAudioLesson ? 'Audio' : 'Text'}</span></div>
                  <div className="home-shelf-meta"><span>{text.languageName}{when ? ` · ${when}` : ''}</span><span>{summary.percent != null ? `${summary.percent}%` : summary.position}</span></div>
                  {summary.percent != null && <ProgressBar><ProgressBar now={summary.percent} aria-label={`${resumeTitle(text)}: ${summary.label}`} /></ProgressBar>}
                </div>
                <i className={`bi bi-${text.isAudioLesson ? 'play-fill' : 'chevron-right'} home-shelf-arrow`} aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      </Card.Body>
    </Card>
  );
};

export default MoreToResumeList;
