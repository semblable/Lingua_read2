import React from 'react';
import { Badge } from 'react-bootstrap';

const LEVEL_VARIANTS = {
  A1: 'secondary',
  A2: 'info',
  B1: 'primary',
  B2: 'success',
  C1: 'warning',
  C2: 'danger',
};

const CefrBadge = ({ level, className = '' }) => {
  if (!level) return null;
  const variant = LEVEL_VARIANTS[level] || 'secondary';
  return (
    <Badge bg={variant} className={className} pill>
      {level}
    </Badge>
  );
};

export default CefrBadge;
