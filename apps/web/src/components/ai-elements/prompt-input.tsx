'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';

// Thin adaptation of the AI Elements 1.9.0 Prompt Input registry source. CMaster owns
// the View Model and commands; attachment and AI SDK UI-part state are intentionally omitted.
export interface PromptInputViewModel {
  readonly value: string;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly submitting: boolean;
  readonly overLimit: boolean;
  readonly placeholder: string;
  readonly sendLabel: string;
}

export interface PromptInputCommands {
  onChange(value: string): void;
  onSubmit(): void;
}

/**
 * Thin adaptation of AI Elements 1.9.0 `prompt-input` registry source. It retains the upstream
 * form/requestSubmit and dual IME guards, while deliberately removing attachment, AI SDK UI part,
 * and provider-controller state. CMaster supplies primitive View Models and Commands.
 */
export function PromptInput({
  viewModel,
  commands,
}: Readonly<{ viewModel: PromptInputViewModel; commands: PromptInputCommands }>) {
  const [isComposing, setIsComposing] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!viewModel.disabled && !viewModel.submitting && !viewModel.overLimit
      && viewModel.value.trim()) commands.onSubmit();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey || isComposing || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form className="prompt-input" onSubmit={submit}>
      <label className="sr-only" htmlFor="conversation-draft">{viewModel.placeholder}</label>
      <textarea
        id="conversation-draft"
        aria-describedby="composer-feedback"
        disabled={viewModel.disabled}
        readOnly={viewModel.readOnly}
        maxLength={32 * 1024 + 1}
        placeholder={viewModel.placeholder}
        value={viewModel.value}
        onChange={(event) => commands.onChange(event.target.value)}
        onCompositionEnd={() => setIsComposing(false)}
        onCompositionStart={() => setIsComposing(true)}
        onKeyDown={keyDown}
      />
      <button
        className="button prompt-input-submit"
        disabled={viewModel.disabled || viewModel.submitting || viewModel.overLimit || !viewModel.value.trim()}
        type="submit"
      >{viewModel.sendLabel}</button>
    </form>
  );
}
