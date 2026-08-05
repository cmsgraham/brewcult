/**
 * The reusable uploader (components/media/image-upload.tsx) and the transport
 * under it (lib/media-client.ts).
 *
 * Nothing here touches a live server: `fetchImpl` is injected all the way down,
 * which is the same seam every other client module in this app uses.
 *
 * The two things worth guarding are the two things that silently break real
 * uploads: a hand-set `Content-Type` (which destroys the multipart boundary),
 * and an API rejection that reaches the user as "Request failed (413)".
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageUpload } from '../components/media/image-upload';
import { resetRefreshState } from '../lib/api';
import {
  MAX_IMAGE_BYTES,
  describeMediaError,
  initialsFrom,
  normalizeMedia,
  readImageUrl,
  uploadMedia,
  validateImageFile,
  type MediaAsset,
} from '../lib/media-client';

const ASSET = {
  id: 'media-1',
  url: 'https://media.brewcult.test/a.jpg',
  thumbnail_url: 'https://media.brewcult.test/a-thumb.jpg',
  width: 1200,
  height: 900,
  mime_type: 'image/jpeg',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function imageFile(name = 'bean.jpg'): File {
  return new File(['not-really-jpeg-bytes'], name, { type: 'image/jpeg' });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRefreshState();
});

describe('uploading', () => {
  it('posts multipart to /api/v1/media and surfaces the returned id', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(ASSET, 201);
    });
    const uploaded: MediaAsset[] = [];
    const user = userEvent.setup();

    render(
      <ImageUpload
        label="Profile photo"
        fetchImpl={fetchImpl}
        onUploaded={(asset) => {
          uploaded.push(asset);
        }}
      />,
    );

    await user.upload(screen.getByLabelText('Profile photo'), imageFile());

    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect(uploaded[0]?.id).toBe('media-1');
    expect(uploaded[0]?.thumbnail_url).toBe(ASSET.thumbnail_url);

    const [call] = calls;
    // `kind` rides in the query string: the API validates it before reading a
    // byte of the body, and gates permission on it.
    expect(call?.url).toBe('/api/v1/media?kind=avatar');
    expect(call?.init?.method).toBe('POST');

    // Multipart, with the file under the field name the API expects.
    const body = call?.init?.body;
    expect(body).toBeInstanceOf(FormData);
    const sent = (body as FormData).get('file');
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe('bean.jpg');
    expect((body as FormData).get('kind')).toBe('avatar');

    // The boundary is the browser's job. Setting Content-Type here would make
    // the request unparseable, so it must be absent.
    expect(new Headers(call?.init?.headers).get('content-type')).toBeNull();

    // And the outcome is announced, not just implied by a vanished spinner.
    expect(await screen.findByText(/photo added/i)).toBeInTheDocument();
  });

  it('offers replace and remove once there is a picture', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ASSET, 201));
    const removed = vi.fn();
    const user = userEvent.setup();

    render(<ImageUpload label="Profile photo" fetchImpl={fetchImpl} onRemove={removed} />);
    await user.upload(screen.getByLabelText('Profile photo'), imageFile());

    await screen.findByText(/photo added/i);
    await user.click(screen.getByRole('button', { name: /remove photo/i }));

    expect(removed).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /remove photo/i })).toBeNull(),
    );
  });

  it('says plainly that location data is stripped', () => {
    render(<ImageUpload label="Photo" fetchImpl={vi.fn()} />);
    expect(screen.getByText(/location data is stripped from photos/i)).toBeInTheDocument();
  });
});

describe('errors the API sends back', () => {
  async function uploadAndRead(status: number, body: unknown): Promise<string> {
    const fetchImpl = vi.fn(async () => jsonResponse(body, status));
    const user = userEvent.setup();
    render(<ImageUpload label="Profile photo" fetchImpl={fetchImpl} />);
    await user.upload(screen.getByLabelText('Profile photo'), imageFile());
    const alert = await screen.findByRole('alert');
    return alert.textContent ?? '';
  }

  it('renders an oversize rejection as a friendly line, not a status code', async () => {
    const text = await uploadAndRead(413, { error: 'file_too_large', message: 'Payload too large' });
    expect(text).toMatch(/5 MB/);
    expect(text).not.toMatch(/413/);
  });

  it('renders an unsupported type as something a person can act on', async () => {
    const text = await uploadAndRead(415, {
      error: 'unsupported_media_type',
      message: 'Unsupported',
    });
    expect(text).toMatch(/not supported/i);
    expect(text).toMatch(/JPEG/);
  });

  it('renders a quota rejection with the way out of it', async () => {
    const text = await uploadAndRead(403, { error: 'quota_exceeded', message: 'Quota' });
    expect(text).toMatch(/storage is full/i);
    expect(text).toMatch(/removing an old photo/i);
  });

  it("keeps the API's own quota wording, which is more specific than ours", async () => {
    // The media module answers the daily cap with 429 and a genuinely useful
    // line; the generic `rate_limited` copy would throw that information away.
    const text = await uploadAndRead(429, {
      error: 'rate_limited',
      message: "You've uploaded 40 images in the last 24 hours, which is the daily limit.",
    });
    expect(text).toMatch(/40 images in the last 24 hours/);
  });

  it('degrades gracefully when the endpoint does not exist yet', async () => {
    const text = await uploadAndRead(404, { error: 'not_found', message: '' });
    expect(text).toMatch(/not switched on yet/i);
    expect(text).toMatch(/everything else saved normally/i);
  });
});

describe('client-side pre-flight', () => {
  it('refuses an oversize file before spending the upload', () => {
    const complaint = validateImageFile({
      size: MAX_IMAGE_BYTES + 1,
      type: 'image/jpeg',
    } as unknown as File);
    expect(complaint).toMatch(/5 MB/);
  });

  it('refuses a non-image', () => {
    expect(validateImageFile({ size: 10, type: 'text/plain' } as unknown as File)).toMatch(
      /not an image/i,
    );
  });

  it('lets a normal photo through', () => {
    expect(validateImageFile(imageFile())).toBeNull();
  });
});

describe('tolerant reading', () => {
  it('normalises the documented response shape', () => {
    expect(normalizeMedia(ASSET)).toMatchObject({ id: 'media-1', url: ASSET.url });
  });

  it('unwraps an enveloped response', () => {
    expect(normalizeMedia({ media: ASSET })?.id).toBe('media-1');
  });

  it('answers null for something it cannot read', () => {
    expect(normalizeMedia({ nope: true })).toBeNull();
    expect(normalizeMedia(null)).toBeNull();
  });

  it('reads an entity image under every spelling the API might use', () => {
    expect(readImageUrl({ image_url: 'a.jpg' })).toBe('a.jpg');
    expect(readImageUrl({ imageUrl: 'b.jpg' })).toBe('b.jpg');
    expect(readImageUrl({ image: { url: 'c.jpg' } })).toBe('c.jpg');
    expect(readImageUrl({ images: [{ url: 'd.jpg' }] })).toBe('d.jpg');
    expect(readImageUrl({ media: { thumbnail_url: 't.jpg', url: 'f.jpg' } })).toBe('f.jpg');
    expect(
      readImageUrl({ media: { thumbnail_url: 't.jpg', url: 'f.jpg' } }, { prefer: 'thumbnail' }),
    ).toBe('t.jpg');
  });

  it('answers null when there is no image, so the card stays text-only', () => {
    expect(readImageUrl({ name: 'Ethiopia Chelbesa' })).toBeNull();
    expect(readImageUrl(undefined)).toBeNull();
    expect(readImageUrl({ image_url: '   ' })).toBeNull();
  });

  it('never surfaces a raw failure', () => {
    expect(describeMediaError(new Error('boom'))).toMatch(/did not go through/i);
  });
});

describe('initials', () => {
  it('takes two letters from a display name', () => {
    expect(initialsFrom('Anna Ortiz')).toBe('AO');
  });

  it('falls back through the candidates it is given', () => {
    expect(initialsFrom(null, '@anna')).toBe('A');
    expect(initialsFrom('', 'anna-ortiz')).toBe('AO');
    expect(initialsFrom(null, undefined)).toBe('');
  });
});

describe('uploadMedia', () => {
  it('rejects a 2xx it cannot read rather than inventing an asset', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }, 201));
    await expect(uploadMedia(imageFile(), 'avatar', { fetchImpl })).rejects.toMatchObject({
      name: 'ApiError',
    });
  });
});
