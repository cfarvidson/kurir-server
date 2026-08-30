// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { KurirLogo } from "@/components/logo";

function pngSize(path: string) {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("KurirLogo", () => {
  it("does not shrink in a flex row", () => {
    const { getByAltText } = render(
      <div style={{ display: "flex", width: 80 }}>
        <KurirLogo className="h-8 w-8" />
        <span>Kurir</span>
      </div>,
    );
    const img = getByAltText("Kurir");
    expect(img.getAttribute("width")).toBe("32");
    expect(img.getAttribute("height")).toBe("32");
    expect(img.className).toContain("shrink-0");
    expect(img.className).toContain("aspect-square");
    expect(img.className).toContain("object-cover");
  });

  it("keeps shrink-0 at the admin size", () => {
    const { getByAltText } = render(<KurirLogo className="h-6 w-6" />);
    const img = getByAltText("Kurir");
    expect(img.className).toContain("shrink-0");
    expect(img.className).toContain("h-6");
    expect(img.className).toContain("w-6");
  });

  it("ships a square production asset", () => {
    const size = pngSize(resolve(process.cwd(), "public/logo.png"));
    expect(size.width).toBe(512);
    expect(size.height).toBe(512);
  });
});
