// @vitest-environment jsdom
/**
 * NEW compose assistant: Generate draft enables once To is filled, the
 * generate call carries type NEW, Insert hands body (and subject) to the
 * composer, and a refusal leaves the composer untouched.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

const generateDraft = vi.fn();
const getDraftGenerationSettings = vi.fn();
const toastError = vi.fn();

vi.mock("@/actions/draft-generation", () => ({
  generateDraft: (...args: unknown[]) => generateDraft(...args),
  getDraftGenerationSettings: (...args: unknown[]) =>
    getDraftGenerationSettings(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { DraftAssistant } from "@/components/mail/draft-assistant";

async function renderReady(props: {
  to?: string;
  onInsert?: (draft: { body: string; subject?: string }) => void;
  disabled?: boolean;
}) {
  getDraftGenerationSettings.mockResolvedValue({
    connected: true,
    provider: "claudeCode",
  });
  const onInsert = props.onInsert ?? vi.fn();
  render(
    <DraftAssistant
      type="NEW"
      contextMessageId="new-1"
      to={props.to}
      onInsert={onInsert}
      disabled={props.disabled}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Generate draft/i })).toBeTruthy(),
  );
  return { onInsert };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  generateDraft.mockReset();
  getDraftGenerationSettings.mockReset();
  toastError.mockReset();
});

describe("DraftAssistant NEW", () => {
  it("stays disabled until a To address is filled", async () => {
    await renderReady({ to: "  " });
    expect(
      (screen.getByRole("button", { name: /Generate draft/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("enables once To is filled, generates, and Insert hands the body and subject to the composer", async () => {
    generateDraft.mockResolvedValue({
      ok: true,
      body: "Hi Ada, about March.",
      subject: "The March invoice",
    });
    const { onInsert } = await renderReady({ to: "ada@x.y" });

    const trigger = screen.getByRole("button", {
      name: /Generate draft/i,
    }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    fireEvent.click(trigger);

    fireEvent.change(screen.getByLabelText(/What should this mail say/i), {
      target: { value: "Ask about the March invoice" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/i }));

    await waitFor(() => expect(generateDraft).toHaveBeenCalled());
    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "NEW",
        contextMessageId: "new-1",
        to: "ada@x.y",
        instruction: "Ask about the March invoice",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Insert$/i }));
    expect(onInsert).toHaveBeenCalledWith({
      body: "Hi Ada, about March.",
      subject: "The March invoice",
    });
  });

  it("a generate error toasts and does not insert", async () => {
    generateDraft.mockResolvedValue({
      ok: false,
      code: "NOTHING_TO_INFER",
      error:
        "There is no earlier mail with this person. Say what this mail should say.",
    });
    const { onInsert } = await renderReady({ to: "ada@x.y" });

    fireEvent.click(screen.getByRole("button", { name: /Generate draft/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(
      "There is no earlier mail with this person. Say what this mail should say.",
    );
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Insert$/i })).toBeNull();
  });
});
