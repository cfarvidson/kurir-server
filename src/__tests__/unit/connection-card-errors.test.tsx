// @vitest-environment jsdom
/**
 * ConnectionCard must not wedge when an action fails.
 *
 * Regression: a failed/stalled PATCH left the catch-all switch (and every
 * other control) permanently disabled because the busy flag was never reset,
 * and the rejection escalated to the route error boundary.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import {
  ConnectionCard,
  type EmailConnection,
} from "@/components/settings/connection-card";

const connection: EmailConnection = {
  id: "conn1",
  email: "user@example.com",
  displayName: null,
  sendAsEmail: null,
  aliases: [],
  treatDomainAsOwn: false,
  imapHost: "imap.example.com",
  smtpHost: "smtp.example.com",
  isDefault: true,
  createdAt: new Date().toISOString(),
};

function renderCard(overrides: Partial<Parameters<typeof ConnectionCard>[0]>) {
  const noop = vi.fn().mockResolvedValue(undefined);
  return render(
    <ConnectionCard
      connection={connection}
      onSetDefault={noop}
      onDelete={noop}
      onSync={noop}
      onUpdateSendAs={noop}
      onUpdateAliases={noop}
      onUpdateTreatDomainAsOwn={noop}
      isOnly={true}
      {...overrides}
    />,
  );
}

async function openAliasForm() {
  fireEvent.click(screen.getByRole("button", { name: /More options/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Manage aliases/ }));
  await waitFor(() => expect(screen.getByRole("switch")).toBeTruthy());
}

afterEach(cleanup);

describe("ConnectionCard action failures", () => {
  it("re-enables the catch-all switch and shows an error when the update rejects", async () => {
    const failingUpdate = vi
      .fn()
      .mockRejectedValue(new Error("Could not reach the server."));
    renderCard({ onUpdateTreatDomainAsOwn: failingUpdate });

    await openAliasForm();
    const toggle = screen.getByRole("switch") as HTMLButtonElement;
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(failingUpdate).toHaveBeenCalledWith("conn1", true);
    expect(screen.getByText(/Could not reach the server\./)).toBeTruthy();
  });

  it("clears the error message when a later action succeeds", async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not reach the server."))
      .mockResolvedValue(undefined);
    renderCard({ onUpdateTreatDomainAsOwn: update });

    await openAliasForm();
    const toggle = screen.getByRole("switch") as HTMLButtonElement;
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(screen.getByText(/Could not reach the server\./)).toBeTruthy();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.queryByText(/Could not reach the server\./)).toBeNull(),
    );
    await waitFor(() => expect(toggle.disabled).toBe(false));
  });
});
