/**
 * The two ends of a catalogue proposal (0011, tier 2).
 *
 * The claim worth pinning is the one the whole design rests on: what gets
 * approved is what the REVIEWER left in the fields, not what the assistant
 * drafted. The API enforces it too, but a console that posts `ai_draft` back
 * would make the human a rubber stamp regardless of what the API accepts — and
 * that failure is invisible in the happy path, because a correct draft and a
 * confirmed draft look identical.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';

const apiFetch = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../lib/api');
  return { ...actual, apiFetch };
});

const { EquipmentRequestsConsole } = await import('../components/admin/equipment-requests-console');
const { EquipmentRequestForm } = await import('../components/profile/equipment-request-form');

const QUEUED = {
  id: 'req-1',
  requester_handle: 'maya',
  submitted_text: 'Option-O Lagom P100, 64mm flat burrs, single dose',
  image_url: null,
  // Confidently wrong: the P64 is a different grinder.
  ai_draft: {
    brand: 'Option-O',
    name: 'Lagom P64',
    category: 'grinder',
    grind_scale_type: 'stepped',
    confidence: 'high',
    notes: 'Assumed the 64mm variant.',
  },
  ai_error: null,
  status: 'pending' as const,
  decision_note: null,
  created_at: '2026-08-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the reviewer’s queue', () => {
  it('approves what the reviewer typed, not what the assistant drafted', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ items: [QUEUED] });
    render(<EquipmentRequestsConsole />);

    const model = await screen.findByLabelText('Model');
    expect(model).toHaveValue('Lagom P64'); // pre-filled from the draft…

    await user.clear(model);
    await user.type(model, 'Lagom P100'); // …and corrected by a person
    await user.selectOptions(screen.getByLabelText('Grind scale (required)'), 'stepless');

    apiFetch.mockClear();
    await user.click(screen.getByRole('button', { name: /Add to catalogue/ }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add to catalogue' }),
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, init] = apiFetch.mock.calls[0]!;
    expect(path).toBe('/api/v1/admin/equipment-requests/req-1/approve');
    expect(init.body).toEqual({
      brand: 'Option-O',
      name: 'Lagom P100',
      category: 'grinder',
      grind_scale_type: 'stepless',
    });
  });

  it('shows the submission next to the draft, so the draft can be checked', async () => {
    apiFetch.mockResolvedValue({ items: [QUEUED] });
    render(<EquipmentRequestsConsole />);

    expect(
      await screen.findByText('Option-O Lagom P100, 64mm flat burrs, single dose'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Assumed the 64mm variant/)).toBeInTheDocument();
    expect(screen.getByText(/draft confidence: high/)).toBeInTheDocument();
  });

  it('will not let a grinder through without a grind scale', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({
      items: [{ ...QUEUED, ai_draft: { ...QUEUED.ai_draft, grind_scale_type: undefined } }],
    });
    render(<EquipmentRequestsConsole />);

    // The catalogue rejects it (0003) — being told here beats a failed POST.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add to catalogue/ })).toBeDisabled(),
    );
    await user.selectOptions(screen.getByLabelText('Grind scale (required)'), 'stepped');
    expect(screen.getByRole('button', { name: /Add to catalogue/ })).toBeEnabled();
  });

  it('says when the assistant failed, instead of showing an empty draft', async () => {
    apiFetch.mockResolvedValue({
      items: [{ ...QUEUED, ai_draft: null, ai_error: 'provider timeout' }],
    });
    render(<EquipmentRequestsConsole />);

    expect(await screen.findByText(/the assistant failed: provider timeout/)).toBeInTheDocument();
  });
});

describe('suggesting something for the catalogue', () => {
  it('posts the description to the requests endpoint', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ items: [] });
    render(<EquipmentRequestForm />);

    await user.click(screen.getByRole('button', { name: 'Suggest it' }));
    await user.type(screen.getByLabelText('What is it?'), 'Option-O Lagom P100');

    apiFetch.mockClear();
    apiFetch.mockResolvedValue({ items: [QUEUED] });
    await user.click(screen.getByRole('button', { name: 'Send suggestion' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, init] = apiFetch.mock.calls[0]!;
    expect(path).toBe('/api/v1/equipment-requests');
    expect(init.method).toBe('POST');
    expect(init.body).toEqual({ description: 'Option-O Lagom P100' });
  });

  it('says a person decides, rather than implying it is instant', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ items: [] });
    render(<EquipmentRequestForm />);

    await user.click(screen.getByRole('button', { name: 'Suggest it' }));
    expect(screen.getByText(/a person checks that draft/)).toBeInTheDocument();
  });

  it('will not send an empty suggestion', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ items: [] });
    render(<EquipmentRequestForm />);

    await user.click(screen.getByRole('button', { name: 'Suggest it' }));
    expect(screen.getByRole('button', { name: 'Send suggestion' })).toBeDisabled();
  });
});
