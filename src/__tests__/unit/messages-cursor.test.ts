import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  parseCursor,
  encodeChronoCursor,
  parseChronoCursor,
} from "@/lib/mail/messages";

describe("encodeCursor / parseCursor", () => {
  const date = new Date("2026-03-15T10:30:00.000Z");
  const id = "cm1234567890abcdefghij";

  it("round-trips an unread message cursor", () => {
    const cursor = encodeCursor({ isRead: false, receivedAt: date, id });
    expect(cursor).toBe(`0_${date.toISOString()}_${id}`);

    const parsed = parseCursor(cursor);
    expect(parsed).not.toBeNull();
    expect(parsed!.OR).toHaveLength(3);
    expect(parsed!.OR[2]).toEqual({ isRead: true });
  });

  it("round-trips a read message cursor", () => {
    const cursor = encodeCursor({ isRead: true, receivedAt: date, id });
    expect(cursor).toBe(`1_${date.toISOString()}_${id}`);

    const parsed = parseCursor(cursor);
    expect(parsed).not.toBeNull();
    expect(parsed!.OR).toHaveLength(2);
    expect(parsed!.OR[0]).toMatchObject({ isRead: true });
    expect(parsed!.OR[1]).toMatchObject({ isRead: true });
  });

  it("returns null for empty string", () => {
    expect(parseCursor("")).toBeNull();
  });

  it("returns null for missing underscore", () => {
    expect(parseCursor("nounderscore")).toBeNull();
  });

  it("returns null for invalid isRead prefix", () => {
    expect(parseCursor(`2_${date.toISOString()}_${id}`)).toBeNull();
  });

  it("returns null for invalid date", () => {
    expect(parseCursor(`0_not-a-date_${id}`)).toBeNull();
  });

  it("returns null for invalid cuid format", () => {
    expect(parseCursor(`0_${date.toISOString()}_not-a-cuid`)).toBeNull();
  });
});

describe("encodeChronoCursor / parseChronoCursor", () => {
  const date = new Date("2026-03-15T10:30:00.000Z");
  const id = "cm1234567890abcdefghij";

  it("round-trips a chrono cursor", () => {
    const cursor = encodeChronoCursor({ receivedAt: date, id });
    expect(cursor).toBe(`${date.toISOString()}_${id}`);

    const parsed = parseChronoCursor(cursor);
    expect(parsed).not.toBeNull();
    expect(parsed!.OR).toHaveLength(2);
    expect(parsed!.OR[0]).toMatchObject({ receivedAt: { lt: date } });
  });

  it("returns null for empty string", () => {
    expect(parseChronoCursor("")).toBeNull();
  });

  it("returns null for invalid date", () => {
    expect(parseChronoCursor(`garbage_${id}`)).toBeNull();
  });

  it("returns null for invalid cuid format", () => {
    expect(parseChronoCursor(`${date.toISOString()}_bad`)).toBeNull();
  });
});
