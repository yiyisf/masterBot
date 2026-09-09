// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptInput } from './prompt-input';

afterEach(cleanup);

function renderPrompt(value = 'Complete the report') {
  const onSubmit = vi.fn();
  render(<PromptInput
    viewModel={{
      value, disabled: false, readOnly: false, submitting: false, overLimit: false,
      placeholder: 'Describe the work', sendLabel: 'Send',
    }}
    commands={{ onChange: vi.fn(), onSubmit }}
  />);
  return { onSubmit, textbox: screen.getByRole('textbox') };
}

describe('AI Elements Prompt Input adaptation', () => {
  it('submits with Enter while Shift+Enter remains a newline gesture', () => {
    const { onSubmit, textbox } = renderPrompt();
    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('never submits during IME composition', () => {
    const { onSubmit, textbox } = renderPrompt();
    fireEvent.compositionStart(textbox);
    fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(textbox);
    fireEvent.keyDown(textbox, { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps a visible send button and disables blank input', () => {
    renderPrompt('   ');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
  });
});
