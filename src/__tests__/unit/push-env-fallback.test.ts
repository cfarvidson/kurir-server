import { describe, it, expect, vi } from "vitest";
import { sendIosWithEnvFallback } from "@/lib/mail/push-sender";
import type { ApnsSendResult } from "@/lib/push/apns";

const OK: ApnsSendResult = { ok: true, gone: false, status: 200 };
const BAD_TOKEN: ApnsSendResult = {
  ok: false,
  gone: true,
  status: 400,
  reason: "BadDeviceToken",
};
const SERVER_ERROR: ApnsSendResult = {
  ok: false,
  gone: false,
  status: 500,
  reason: "InternalServerError",
};

const payload = { title: "t", body: "b", url: "/imbox/m1" };

describe("sendIosWithEnvFallback", () => {
  it("uses the known env and does not retry on success", async () => {
    const send = vi.fn().mockResolvedValue(OK);
    const { result, workedEnv } = await sendIosWithEnvFallback(
      send,
      "tok",
      payload,
      "production",
      true, // default says sandbox — known env must win
    );
    expect(result.ok).toBe(true);
    expect(workedEnv).toBe("production");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("tok", payload, { sandbox: false });
  });

  it("falls back to the default env when none is known", async () => {
    const send = vi.fn().mockResolvedValue(OK);
    const { workedEnv } = await sendIosWithEnvFallback(
      send,
      "tok",
      payload,
      null,
      true,
    );
    expect(workedEnv).toBe("sandbox");
    expect(send).toHaveBeenCalledWith("tok", payload, { sandbox: true });
  });

  it("retries the other gateway on BadDeviceToken and reports the env that worked", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(BAD_TOKEN)
      .mockResolvedValueOnce(OK);
    const { result, workedEnv } = await sendIosWithEnvFallback(
      send,
      "tok",
      payload,
      null,
      true, // default sandbox fails → production accepts (TestFlight token)
    );
    expect(result.ok).toBe(true);
    expect(workedEnv).toBe("production");
    expect(send).toHaveBeenNthCalledWith(1, "tok", payload, { sandbox: true });
    expect(send).toHaveBeenNthCalledWith(2, "tok", payload, { sandbox: false });
  });

  it("reports gone only when both gateways reject the token", async () => {
    const send = vi.fn().mockResolvedValue(BAD_TOKEN);
    const { result, workedEnv } = await sendIosWithEnvFallback(
      send,
      "tok",
      payload,
      null,
      false,
    );
    expect(result.ok).toBe(false);
    expect(result.gone).toBe(true);
    expect(workedEnv).toBe(null);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not retry or mark gone on non-token errors", async () => {
    const send = vi.fn().mockResolvedValue(SERVER_ERROR);
    const { result, workedEnv } = await sendIosWithEnvFallback(
      send,
      "tok",
      payload,
      "sandbox",
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.gone).toBe(false);
    expect(workedEnv).toBe(null);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
