import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { copy } from '@/content/copy';
import type { AuthActionState } from '@/server/actions/action-state';

/**
 * The sign-in form, as a person uses it.
 *
 * The actions are replaced with what the server would answer; the form's own
 * behaviour — what it shows, what it lets you press, and when — is real.
 */

const requestSignIn = vi.fn<(previous: AuthActionState, data: FormData) => Promise<AuthActionState>>();
const verifySignInCode = vi.fn();

vi.mock('@/server/actions/auth', () => ({
  requestSignIn: (previous: AuthActionState, data: FormData) => requestSignIn(previous, data),
  verifySignInCode: (...args: unknown[]) => verifySignInCode(...args),
  startGoogleSignIn: vi.fn(),
}));

async function renderForm() {
  const { SignInForm } = await import('@/app/sign-in/sign-in-form');
  return render(
    <SignInForm next="/review" isLocalAdapter={false} googleEnabled={false} linkLifetimeMinutes={60} />,
  );
}

beforeEach(() => {
  requestSignIn.mockReset();
  verifySignInCode.mockReset();
});

describe('after a link is sent', () => {
  beforeEach(() => {
    requestSignIn.mockResolvedValue({
      error: null,
      sentTo: 'someone@example.com',
      email: 'someone@example.com',
      cooldownSeconds: 60,
      sentCount: 1,
    });
  });

  it('says where it went and how to use it', async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.type(screen.getByLabelText(copy.auth.email), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: copy.auth.sendLink }));

    expect(await screen.findByText(copy.auth.linkSentTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.auth.linkSentBody('someone@example.com'))).toBeInTheDocument();
    expect(screen.getByText(copy.auth.linkSentHowTo(60))).toBeInTheDocument();
    expect(screen.getByText(/expires in 1 hour/)).toBeInTheDocument();
  });

  it('offers the code for a different device', async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.type(screen.getByLabelText(copy.auth.email), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: copy.auth.sendLink }));

    const code = await screen.findByLabelText(copy.auth.codeLabel);
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
  });

  it('holds the resend back for exactly the interval Supabase enforces', async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.type(screen.getByLabelText(copy.auth.email), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: copy.auth.sendLink }));

    const resend = await screen.findByRole('button', { name: copy.auth.resendIn(60) });
    expect(resend).toBeDisabled();
    expect(copy.auth.resendIn(60)).toBe('Send a new link in 1:00');
  });

  it('lets the address be changed, and keeps what was typed', async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.type(screen.getByLabelText(copy.auth.email), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: copy.auth.sendLink }));
    await user.click(await screen.findByRole('button', { name: copy.auth.changeEmail }));

    expect(screen.getByLabelText(copy.auth.email)).toHaveValue('someone@example.com');
    expect(screen.getByRole('button', { name: copy.auth.sendLink })).toBeEnabled();
  });
});

describe('a refused request', () => {
  it('shows the cooldown and counts down on the button instead of in the sentence', async () => {
    requestSignIn.mockResolvedValue({
      error: copy.auth.cooldown,
      sentTo: null,
      email: 'someone@example.com',
      cooldownSeconds: 42,
      sentCount: 0,
    });
    const user = userEvent.setup();
    await renderForm();

    await user.type(screen.getByLabelText(copy.auth.email), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: copy.auth.sendLink }));

    expect(await screen.findByText(copy.auth.cooldown)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.auth.resendIn(42) })).toBeDisabled();
    expect(screen.getByLabelText(copy.auth.email)).toHaveValue('someone@example.com');
  });

  it('shows no countdown when the wait is not known', async () => {
    requestSignIn.mockResolvedValue({
      error: copy.auth.tooManyLinks,
      sentTo: null,
      email: 'someone@example.com',
      cooldownSeconds: null,
      sentCount: 0,
    });
    const user = userEvent.setup();
    await renderForm();

    await user.type(screen.getByLabelText(copy.auth.email), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: copy.auth.sendLink }));

    expect(await screen.findByText(copy.auth.tooManyLinks)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.auth.sendLink })).toBeEnabled();
  });
});

describe('overlapping requests', () => {
  it('sends one request for a double press', async () => {
    let finish: (state: AuthActionState) => void = () => {};
    requestSignIn.mockImplementation(
      () => new Promise<AuthActionState>((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    await renderForm();

    await user.type(screen.getByLabelText(copy.auth.email), 'someone@example.com');
    const button = screen.getByRole('button', { name: copy.auth.sendLink });
    await user.click(button);
    await user.type(screen.getByLabelText(copy.auth.email), '{Enter}');

    finish({ error: null, sentTo: 'someone@example.com', cooldownSeconds: 60, sentCount: 1 });

    await waitFor(() => expect(screen.getByText(copy.auth.linkSentTitle)).toBeInTheDocument());
    expect(requestSignIn).toHaveBeenCalledTimes(1);
  });
});
