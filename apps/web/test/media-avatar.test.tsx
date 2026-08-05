/**
 * Avatar display + the profile editor around it.
 *
 * The assertion that matters most is the boring one: with no picture, a person
 * still renders as a person. Every other screen in the app assumes that.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Avatar } from '../components/media/avatar';
import { AvatarEditor } from '../components/media/avatar-editor';
import { resetRefreshState } from '../lib/api';
import { readAvatarUrl } from '../lib/media-client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRefreshState();
});

describe('Avatar', () => {
  it('falls back to initials when there is no image', () => {
    render(<Avatar displayName="Anna Ortiz" handle="anna" />);

    expect(screen.getByText('AO')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    // …and a screen reader is told what it is looking at, not left with "AO".
    expect(screen.getByText(/no photo yet/i)).toBeInTheDocument();
  });

  it('falls back to the handle when there is no display name', () => {
    render(<Avatar handle="@chelbesa" />);
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('never renders a stray letter for an empty identity', () => {
    render(<Avatar />);
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the picture when there is one, with a name for it', () => {
    render(<Avatar src="https://media.brewcult.test/a.jpg" displayName="Anna Ortiz" />);

    const image = screen.getByRole('img', { name: /anna ortiz's profile photo/i });
    expect(image).toHaveAttribute('src', 'https://media.brewcult.test/a.jpg');
    expect(screen.queryByText('AO')).toBeNull();
  });

  it('reads the avatar out of a user payload whatever it is called', () => {
    expect(readAvatarUrl({ avatar_url: 'a.jpg' })).toBe('a.jpg');
    expect(readAvatarUrl({ avatarUrl: 'b.jpg' })).toBe('b.jpg');
    expect(readAvatarUrl({ avatar: { url: 'c.jpg' } })).toBe('c.jpg');
    expect(readAvatarUrl({ handle: 'anna' })).toBeNull();

    render(<Avatar user={{ avatar_url: 'https://media.brewcult.test/u.jpg' }} handle="anna" />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'https://media.brewcult.test/u.jpg',
    );
  });
});

describe('AvatarEditor', () => {
  const asset = {
    id: 'media-9',
    url: 'https://media.brewcult.test/new.jpg',
    thumbnail_url: null,
    width: 400,
    height: 400,
    mime_type: 'image/jpeg',
  };

  it('uploads then points the account at the new media id', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
      if (url.startsWith('/api/v1/media?')) return jsonResponse(asset, 201);
      return jsonResponse(undefined, 204);
    });
    const user = userEvent.setup();

    render(<AvatarEditor displayName="Anna Ortiz" handle="anna" fetchImpl={fetchImpl} />);

    await user.upload(
      screen.getByLabelText('Profile photo'),
      new File(['bytes'], 'me.jpg', { type: 'image/jpeg' }),
    );

    await screen.findByText(/that is your profile photo now/i);

    const avatarCall = calls.find((call) => call.url === '/api/v1/users/me/avatar');
    expect(avatarCall?.method).toBe('PUT');
    expect(JSON.parse(String(avatarCall?.body))).toEqual({ media_id: 'media-9' });
  });

  it('says so plainly when photos are not switched on yet', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('/api/v1/media?')) return jsonResponse(asset, 201);
      return jsonResponse({ error: 'not_found', message: '' }, 404);
    });
    const user = userEvent.setup();

    render(<AvatarEditor handle="anna" fetchImpl={fetchImpl} />);
    await user.upload(
      screen.getByLabelText('Profile photo'),
      new File(['bytes'], 'me.jpg', { type: 'image/jpeg' }),
    );

    expect(await screen.findByText(/not switched on yet/i)).toBeInTheDocument();
  });

  it('does not leave orphaned bytes behind a failed assignment', async () => {
    const deletes: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/media?')) return jsonResponse(asset, 201);
      if (init?.method === 'DELETE') {
        deletes.push(url);
        return jsonResponse(undefined, 204);
      }
      return jsonResponse({ error: 'server_error', message: '' }, 500);
    });
    const user = userEvent.setup();

    render(<AvatarEditor handle="anna" fetchImpl={fetchImpl} />);
    await user.upload(
      screen.getByLabelText('Profile photo'),
      new File(['bytes'], 'me.jpg', { type: 'image/jpeg' }),
    );

    await waitFor(() => expect(deletes).toEqual(['/api/v1/media/media-9']));
  });
});
