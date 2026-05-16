import React from 'react';
import { Badge } from 'react-bootstrap';

type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

const LEVEL_VARIANTS: Record<CefrLevel, string> = {
  A1: 'secondary',
  A2: 'info',
  B1: 'primary',
  B2: 'success',
  C1: 'warning',
  C2: 'danger',
};

interface CefrBadgeProps {
  level?: string | null;
  className?: string;
}

const CefrBadge = ({ level, className = '' }: CefrBadgeProps) => {
  if (!level) return null;
  const variant = LEVEL_VARIANTS[level as CefrLevel] || 'secondary';
  return (
    <Badge bg={variant} className={className} pill>
      {level}
    </Badge>
  );
};

export default CefrBadge;
