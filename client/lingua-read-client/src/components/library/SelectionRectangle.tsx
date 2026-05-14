import React from 'react';

const SelectionRectangle = ({ rect }) => {
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
