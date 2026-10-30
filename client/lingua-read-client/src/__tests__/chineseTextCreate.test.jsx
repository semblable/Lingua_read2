import React from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TextCreate from '../pages/TextCreate';
import { createText, getAllLanguages } from '../utils/api';
vi.mock('../utils/api', () => ({ createText: vi.fn(), getAllLanguages: vi.fn(), generateStory: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  getAllLanguages.mockResolvedValue([{ languageId: 1, name: 'Chinese', code: 'zh-TW' }, { languageId: 2, name: 'English', code: 'en' }]);
  createText.mockResolvedValue({ textId: 42 });
});

test('Chinese splitting is an explicit choice for each new text', async () => {
  render(<MemoryRouter><TextCreate /></MemoryRouter>);
  const choice = await screen.findByLabelText('Chinese word segmentation (experimental)');
  expect(choice).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Synthetic Chinese' } });
  fireEvent.change(screen.getByLabelText('Text Content'), { target: { value: '我学习中文。' } });
  fireEvent.click(choice);
  fireEvent.click(screen.getByRole('button', { name: 'Create Text', exact: true }));
  await waitFor(() => expect(createText).toHaveBeenCalledWith('Synthetic Chinese', '我学习中文。', 1, null, null, 'jieba-v1'));
});

test('switching to another language cannot submit a Chinese profile', async () => {
  render(<MemoryRouter><TextCreate /></MemoryRouter>);
  fireEvent.click(await screen.findByLabelText('Chinese word segmentation (experimental)'));
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: '2' } });
  expect(screen.queryByLabelText('Chinese word segmentation (experimental)')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Synthetic English' } });
  fireEvent.change(screen.getByLabelText('Text Content'), { target: { value: 'hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Text', exact: true }));
  await waitFor(() => expect(createText).toHaveBeenCalledWith('Synthetic English', 'hello', 2, null, null, null));
});
