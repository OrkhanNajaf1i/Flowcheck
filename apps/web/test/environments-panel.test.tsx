import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EnvironmentsPanel } from '@/features/environments/environments-panel';

let created: unknown = null;
const server = setupServer(
  http.get('*/api/projects/p1/environments', () => HttpResponse.json([])),
  http.post('*/api/projects/p1/environments', async ({ request }) => {
    created = await request.json();
    return HttpResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: { issues: [{ path: ['apiBaseUrl'], code: 'custom', message: 'Rejected by server' }] },
        },
      },
      { status: 400 },
    );
  }),
);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EnvironmentsPanel projectId="p1" />
    </QueryClientProvider>,
  );
}

describe('EnvironmentsPanel', () => {
  it('shows the empty state, validates on the client and puts server errors on the field', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText('No website added yet')).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Add website' })[0] as HTMLElement);
    await user.type(screen.getByLabelText('Website address'), 'not a url');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Must be an absolute URL')).toBeTruthy();
    expect(created).toBeNull();

    await user.clear(screen.getByLabelText('Website address'));
    await user.type(screen.getByLabelText('Website address'), 'https://staging.example.com');
    await user.type(screen.getByLabelText('Extra allowed domains'), 'https://fonts.googleapis.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Rejected by server')).toBeTruthy();
    // Empty name and API address are filled from the website address.
    await waitFor(() =>
      expect(created).toEqual({
        name: 'staging.example.com',
        kind: 'staging',
        frontendBaseUrl: 'https://staging.example.com',
        apiBaseUrl: 'https://staging.example.com',
        allowedOrigins: ['https://fonts.googleapis.com'],
        allowPrivateNetwork: false,
        enabled: true,
      }),
    );
  });

  it('warns when the website address is local and private network is off', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click((await screen.findAllByRole('button', { name: 'Add website' }))[0] as HTMLElement);
    await user.type(screen.getByLabelText('Website address'), 'http://localhost:3000');
    expect(screen.getByText(/looks like a local or internal address/)).toBeTruthy();
    await user.click(screen.getByRole('switch', { name: 'Allow private network' }));
    expect(screen.queryByText(/looks like a local or internal address/)).toBeNull();
  });
});
