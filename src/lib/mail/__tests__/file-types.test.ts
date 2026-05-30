import { describe, it, expect } from "vitest";
import {
  fileGroup,
  contentTypeMatchesGroup,
  parseFileGroup,
} from "../file-types";

describe("fileGroup", () => {
  it("classifies common image types", () => {
    expect(fileGroup("image/png")).toBe("image");
    expect(fileGroup("image/jpeg")).toBe("image");
    expect(fileGroup("IMAGE/GIF")).toBe("image"); // case-insensitive
  });

  it("classifies document types", () => {
    expect(fileGroup("application/pdf")).toBe("document");
    expect(fileGroup("application/msword")).toBe("document");
    expect(
      fileGroup(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("document");
    expect(fileGroup("text/plain")).toBe("document");
  });

  it("classifies archive types and prefers archive over document", () => {
    expect(fileGroup("application/zip")).toBe("archive");
    expect(fileGroup("application/x-tar")).toBe("archive");
    expect(fileGroup("application/x-7z-compressed")).toBe("archive");
  });

  it("falls back to other for unknown or empty types", () => {
    expect(fileGroup("application/octet-stream")).toBe("other");
    expect(fileGroup("")).toBe("other");
    expect(fileGroup(null)).toBe("other");
    expect(fileGroup(undefined)).toBe("other");
    expect(fileGroup("garbage-not-a-mime")).toBe("other");
  });
});

describe("contentTypeMatchesGroup", () => {
  it("matches within a group and rejects across groups", () => {
    expect(contentTypeMatchesGroup("image/png", "image")).toBe(true);
    expect(contentTypeMatchesGroup("image/png", "document")).toBe(false);
    expect(contentTypeMatchesGroup("application/octet-stream", "other")).toBe(
      true,
    );
  });
});

describe("parseFileGroup", () => {
  it("accepts valid group values", () => {
    expect(parseFileGroup("image")).toBe("image");
    expect(parseFileGroup("OTHER")).toBe("other");
  });

  it("rejects unknown values", () => {
    expect(parseFileGroup("video")).toBeNull();
    expect(parseFileGroup("")).toBeNull();
    expect(parseFileGroup(undefined)).toBeNull();
  });
});
