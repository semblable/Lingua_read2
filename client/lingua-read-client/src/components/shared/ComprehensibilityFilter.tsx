import React from 'react';
import { Form } from 'react-bootstrap';
import {
  bandLabel,
  KRASHEN_SWEET_SPOT_MAX,
  KRASHEN_SWEET_SPOT_MIN,
  type ComprehensionBand,
} from '../../utils/comprehensibility';

export type ComprehensibilityFilterValue = ComprehensionBand | 'all';

interface ComprehensibilityFilterProps {
  value: ComprehensibilityFilterValue;
  onChange: (next: ComprehensibilityFilterValue) => void;
  size?: 'sm' | 'lg';
  style?: React.CSSProperties;
  id?: string;
}

const ORDERED_OPTIONS: Array<{ value: ComprehensibilityFilterValue; label: string }> = [
  { value: 'all', label: 'All comprehension' },
  { value: 'too-hard', label: `${bandLabel('too-hard')} (<70%)` },
  { value: 'challenging', label: `${bandLabel('challenging')} (70–${KRASHEN_SWEET_SPOT_MIN - 1}%)` },
  { value: 'sweet-spot', label: `${bandLabel('sweet-spot')} (${KRASHEN_SWEET_SPOT_MIN}–${KRASHEN_SWEET_SPOT_MAX}%)` },
  { value: 'too-easy', label: `${bandLabel('too-easy')} (≥${KRASHEN_SWEET_SPOT_MAX + 1}%)` },
];

const ComprehensibilityFilter: React.FC<ComprehensibilityFilterProps> = ({
  value,
  onChange,
  size = 'sm',
  style,
  id,
}) => {
  return (
    <Form.Select
      size={size}
      style={style ?? { width: '200px' }}
      value={value}
      onChange={(e) => onChange(e.target.value as ComprehensibilityFilterValue)}
      aria-label="Comprehension filter"
      data-testid="comprehensibility-filter"
      id={id}
    >
      {ORDERED_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </Form.Select>
  );
};

export default ComprehensibilityFilter;
