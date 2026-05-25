import React from 'react';
import { Badge } from 'react-bootstrap';
import {
  bandLabel,
  bandVariant,
  comprehensionBand,
  comprehensionPercent,
  type ComprehensionInput,
} from '../../utils/comprehensibility';

interface ComprehensibilityBadgeProps extends ComprehensionInput {
  className?: string;
  showLabel?: boolean;
}

const ComprehensibilityBadge: React.FC<ComprehensibilityBadgeProps> = ({
  totalWords,
  knownWords,
  unknownWords,
  unknownWordPercentage,
  className,
  showLabel = false,
}) => {
  const percent = comprehensionPercent({
    totalWords,
    knownWords,
    unknownWords,
    unknownWordPercentage,
  });
  if (percent == null) return null;

  const band = comprehensionBand(percent);
  const variant = bandVariant(band);
  const rendered = percent.toFixed(percent >= 99 ? 0 : 1);
  const titleParts: string[] = [`${rendered}% of words known`];
  if (totalWords != null && totalWords > 0) {
    titleParts.push(`${totalWords} word token${totalWords === 1 ? '' : 's'} total`);
  }
  titleParts.push(bandLabel(band));

  return (
    <Badge
      bg={variant}
      data-testid="comprehensibility-badge"
      data-band={band}
      data-percent={percent.toFixed(2)}
      className={className}
      title={titleParts.join(' · ')}
      style={{ fontSize: '0.7rem' }}
    >
      {rendered}% known{showLabel ? ` · ${bandLabel(band)}` : ''}
    </Badge>
  );
};

export default ComprehensibilityBadge;
