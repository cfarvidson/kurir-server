import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  mergeSearchFilters,
  searchConstraintFilter,
  searchFilterSql,
} from "@/lib/mail/search";
import {
  searchCategoryFilter,
  searchQueryHref,
} from "@/lib/mail/list-contract";

describe("searchConstraintFilter", () => {
  it("filters From in isolation", () => {
    const sql = searchConstraintFilter({ from: "  Maya@X.COM " });
    expect(sql.strings.join("")).toContain('LOWER("fromAddress")');
    expect(sql.values).toContain("maya@x.com");
  });

  it("filters domain in isolation", () => {
    const sql = searchConstraintFilter({ domain: "@Gmail.com" });
    expect(sql.strings.join("")).toContain("SPLIT_PART");
    expect(sql.values).toContain("gmail.com");
  });

  it("filters has attachment in isolation", () => {
    const sql = searchConstraintFilter({ hasAttachment: true });
    expect(sql.strings.join("")).toContain('"hasAttachments" = true');
  });

  it("filters date range in isolation", () => {
    const after = new Date("2026-08-23T12:00:00Z");
    const sql = searchConstraintFilter({ after });
    expect(sql.strings.join("")).toContain('"receivedAt" >=');
    expect(sql.values[0]).toEqual(after);
  });

  it("combines From and has attachment", () => {
    const sql = searchConstraintFilter({
      from: "maya@x.com",
      hasAttachment: true,
    });
    const joined = sql.strings.join("");
    expect(joined).toContain('LOWER("fromAddress")');
    expect(joined).toContain('"hasAttachments" = true');
    expect(sql.values).toContain("maya@x.com");
  });

  it("clears a chip by omitting that constraint", () => {
    const filled = searchConstraintFilter({
      from: "maya@x.com",
      domain: "gmail.com",
      hasAttachment: true,
    });
    expect(filled.values).toContain("maya@x.com");
    const clearedFrom = searchConstraintFilter({
      domain: "gmail.com",
      hasAttachment: true,
    });
    expect(clearedFrom.values).not.toContain("maya@x.com");
    expect(clearedFrom.values).toContain("gmail.com");
    expect(clearedFrom.strings.join("")).toContain("SPLIT_PART");
    expect(clearedFrom.strings.join("")).toContain("hasAttachments");
  });

  it("returns empty SQL when every chip is idle", () => {
    expect(searchConstraintFilter({})).toEqual(Prisma.empty);
  });
});

describe("searchFilterSql list chip vs this-list", () => {
  it("keeps this-list category when scope is list", () => {
    const sql = searchFilterSql("imbox", { scope: "list", list: "archive" });
    expect(sql).toEqual(searchCategoryFilter("imbox"));
  });

  it("applies the list chip in All mail", () => {
    const sql = searchFilterSql("imbox", { list: "archive" });
    expect(sql).toEqual(searchCategoryFilter("archive"));
  });

  it("omits category when All mail and no list chip", () => {
    expect(searchFilterSql("imbox", {})).toEqual(Prisma.empty);
  });

  it("merges list chip with From", () => {
    const sql = searchFilterSql("imbox", {
      list: "feed",
      from: "maya@x.com",
    });
    const merged = mergeSearchFilters(searchCategoryFilter("feed"), {
      from: "maya@x.com",
    });
    expect(sql.strings.join("")).toBe(merged.strings.join(""));
    expect(sql.values).toEqual(merged.values);
  });
});

describe("searchQueryHref", () => {
  it("sets a From chip without query syntax", () => {
    const href = searchQueryHref(
      "/imbox",
      new URLSearchParams("q=tax"),
      { from: "maya@x.com" },
    );
    expect(href).toContain("from=maya%40x.com");
    expect(href).toContain("q=tax");
    expect(href).not.toContain("from:");
  });

  it("clears a chip by deleting that param", () => {
    const href = searchQueryHref(
      "/imbox",
      new URLSearchParams("q=tax&from=maya%40x.com&hasAttachment=true"),
      { from: null },
    );
    expect(href).not.toContain("from=");
    expect(href).toContain("hasAttachment=true");
  });

  it("drops the list chip when switching to this-list", () => {
    const href = searchQueryHref(
      "/imbox",
      new URLSearchParams("q=tax&list=archive"),
      { scope: "list" },
    );
    expect(href).toContain("scope=list");
    expect(href).not.toContain("list=");
  });

  it("drops this-list when setting a list chip", () => {
    const href = searchQueryHref(
      "/imbox",
      new URLSearchParams("q=tax&scope=list"),
      { list: "archive", scope: null },
    );
    expect(href).toContain("list=archive");
    expect(href).not.toContain("scope=");
  });
});
