import React from 'react';

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionRectangleProps {
  rect: SelectionRect | null;
}

const SelectionRectangle = ({ rect }: SelectionRectangleProps) => {
  if (!rect) return null;

  return (
    <div
      className="drag-select-rectangle"
      style={{
        position: 'fixed',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
};

export default SelectionRectangle;
