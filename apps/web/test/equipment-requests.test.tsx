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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  // jsdom has no object URLs. Every browser does, and the preview is the only
  // thing that uses them, so a stub here is the whole of the difference.
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  }
});

describe('the reviewer’s queue', () => {
  it('puts the already-published rows above the queue, because that is where a mistake is', async () => {
    // Publication no longer waits for anybody (0013), so the queue holds what
    // did NOT go through and this list holds what did. The second one is where
    // a wrong burr size is actually sitting.
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        String(path).includes('community-equipment')
          ? {
              items: [
                {
                  id: 'm-1',
                  slug: 'timemore-chestnut-c3',
                  name: 'Chestnut C3',
                  brand: 'Timemore',
                  category: 'grinder',
                  submitted_by_handle: 'maya',
                  created_at: '2026-08-05T10:00:00.000Z',
                },
              ],
            }
          : { items: [] },
      ),
    );
    render(<EquipmentRequestsConsole />);

    expect(await screen.findByText('Added by the assistant · 1')).toBeInTheDocument();
    expect(screen.getByText(/These are already public/)).toBeInTheDocument();
  });

  it('confirms a row and drops it off the list', async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        String(path).includes('community-equipment')
          ? {
              items: [
                {
                  id: 'm-1',
                  slug: 'timemore-chestnut-c3',
                  name: 'Chestnut C3',
                  brand: 'Timemore',
                  category: 'grinder',
                  submitted_by_handle: 'maya',
                  created_at: '2026-08-05T10:00:00.000Z',
                },
              ],
            }
          : { items: [] },
      ),
    );
    render(<EquipmentRequestsConsole />);

    await user.click(await screen.findByRole('button', { name: 'Looks right' }));

    const call = apiFetch.mock.calls.find(([path]) => String(path).includes('/reviewed'));
    expect(call?.[0]).toBe('/api/v1/admin/community-equipment/m-1/reviewed');
    await waitFor(() =>
      expect(screen.queryByText('Added by the assistant · 1')).not.toBeInTheDocument(),
    );
  });

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

  it('promises what actually happens: usually instant, sometimes a person', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ items: [] });
    render(<EquipmentRequestForm />);

    await user.click(screen.getByRole('button', { name: 'Suggest it' }));
    // Both halves matter. Promising only the fast path would make the queued
    // case look broken; promising only review would understate it.
    expect(screen.getByText(/added to the catalogue and to your equipment right away/)).toBeInTheDocument();
    expect(screen.getByText(/unsure about waits for a person/)).toBeInTheDocument();
  });

  it('says it is published when the assistant published it', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ items: [] });
    render(<EquipmentRequestForm />);

    await user.click(screen.getByRole('button', { name: 'Suggest it' }));
    await user.type(screen.getByLabelText('What is it?'), 'Timemore Chestnut C3');
    apiFetch.mockResolvedValue({
      items: [
        {
          ...QUEUED,
          status: 'approved',
          ai_draft: { brand: 'Timemore', name: 'Chestnut C3' },
        },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Send suggestion' }));

    expect(await screen.findByText('Timemore Chestnut C3 is in the catalogue.')).toBeInTheDocument();
  });

  it('says a person will look when the assistant was not sure', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ items: [] });
    render(<EquipmentRequestForm />);

    await user.click(screen.getByRole('button', { name: 'Suggest it' }));
    await user.type(screen.getByLabelText('What is it?'), 'some grinder I think');
    apiFetch.mockResolvedValue({ items: [{ ...QUEUED, status: 'pending' }] });
    await user.click(screen.getByRole('button', { name: 'Send suggestion' }));

    expect(await screen.findByText(/not sure enough to add it, so a person will look/)).toBeInTheDocument();
  });

  it('will not send an empty suggestion', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ items: [] });
    render(<EquipmentRequestForm />);

    await user.click(screen.getByRole('button', { name: 'Suggest it' }));
    expect(screen.getByRole('button', { name: 'Send suggestion' })).toBeDisabled();
  });
});

/**
 * Pasting a photo.
 *
 * A screenshot of a product page is the fastest thing most people have to hand,
 * and saving it to disk first only to pick it out of a file dialog is work the
 * browser can do itself.
 */
describe('pasting a photo', () => {
  const png = () =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' });

  async function openForm() {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ items: [] });
    render(<EquipmentRequestForm />);
    await user.click(screen.getByRole('button', { name: 'Suggest it' }));
    return user;
  }

  it('attaches an image pasted anywhere in the form', async () => {
    await openForm();
    const file = png();

    fireEvent.paste(screen.getByLabelText('What is it?'), {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
    });

    expect(await screen.findByAltText('The photo you attached')).toBeInTheDocument();
    expect(screen.getByText('shot.png')).toBeInTheDocument();
  });

  it('leaves pasted TEXT to the textarea, which already handles it', async () => {
    const user = await openForm();
    const box = screen.getByLabelText('What is it?');

    await user.click(box);
    await user.paste('Option-O Lagom P100, 64mm flat burrs');

    expect(box).toHaveValue('Option-O Lagom P100, 64mm flat burrs');
    expect(screen.queryByAltText('The photo you attached')).not.toBeInTheDocument();
  });

  it('refuses an oversize paste before spending the upload', async () => {
    await openForm();
    // 6 MB against a 5 MB cap — the server would reject it after the wait.
    const huge = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });

    fireEvent.paste(screen.getByLabelText('What is it?'), {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => huge }] },
    });

    expect(await screen.findByText(/anything under 5 MB works/)).toBeInTheDocument();
    expect(screen.queryByAltText('The photo you attached')).not.toBeInTheDocument();
  });

  it('lets you take it back off again', async () => {
    const user = await openForm();
    fireEvent.paste(screen.getByLabelText('What is it?'), {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => png() }] },
    });

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.queryByAltText('The photo you attached')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Photo/)).toBeInTheDocument(); // the file input is back
  });

  it('uploads the pasted photo and sends its id, not the file', async () => {
    const user = await openForm();
    fireEvent.paste(screen.getByLabelText('What is it?'), {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => png() }] },
    });
    await user.type(screen.getByLabelText('What is it?'), 'A grinder I cannot name');

    apiFetch.mockClear();
    // The upload answers with an asset; the request then carries only its id.
    apiFetch.mockResolvedValueOnce({ id: 'media-9', url: 'https://media.test/9.webp' });
    apiFetch.mockResolvedValueOnce({ items: [] });
    await user.click(screen.getByRole('button', { name: 'Send suggestion' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const [uploadPath] = apiFetch.mock.calls[0]!;
    // 'equipment_submission', NOT 'equipment_image'. The latter is the picture
    // on a public catalogue page and is staff-only to upload, so uploading a
    // suggestion photo under that kind is a 403 for every ordinary account —
    // which is exactly how this shipped the first time.
    expect(String(uploadPath)).toContain('kind=equipment_submission');
    expect(apiFetch.mock.calls[1]![1].body).toEqual({
      description: 'A grinder I cannot name',
      image_media_id: 'media-9',
    });
  });

  it('offers the button where the browser can read the clipboard', async () => {
    await openForm(); // userEvent installs a clipboard, as a real browser has
    expect(screen.getByRole('button', { name: 'Paste from clipboard' })).toBeInTheDocument();
  });

  it('attaches what the button finds on the clipboard', async () => {
    const user = await openForm();
    const blob = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' });
    vi.spyOn(navigator.clipboard, 'read').mockResolvedValue([
      { types: ['image/png'], getType: async () => blob },
    ] as never);

    await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

    expect(await screen.findByAltText('The photo you attached')).toBeInTheDocument();
    // A clipboard blob has no name, so one is invented rather than sending
    // "upload" for every screenshot anybody ever pastes.
    expect(screen.getByText('pasted-photo.png')).toBeInTheDocument();
  });

  it('says what to do instead when the clipboard is refused', async () => {
    const user = await openForm();
    vi.spyOn(navigator.clipboard, 'read').mockRejectedValue(new Error('NotAllowedError'));

    await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

    expect(await screen.findByText(/Press Ctrl\+V/)).toBeInTheDocument();
  });

  it('hides the button where there is no scripted clipboard read at all', async () => {
    // Firefox's position, and the reason Ctrl+V is described either way.
    const clipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    try {
      apiFetch.mockResolvedValue({ items: [] });
      render(<EquipmentRequestForm />);
      fireEvent.click(screen.getByRole('button', { name: 'Suggest it' }));

      expect(screen.queryByRole('button', { name: 'Paste from clipboard' })).not.toBeInTheDocument();
      expect(screen.getByText(/Copy a screenshot, then press Ctrl\+V/)).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    }
  });
});
