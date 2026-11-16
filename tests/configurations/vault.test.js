// A home's vault (ADR 0019): once per fingerprint, a dry run first,
// grouped by configuration version, documents downloaded. Invented files.
import { beforeEach, describe, expect, it } from "vitest";
import { HomeVault, kindOf } from "../../amplify/functions/home-vault-shared/store.ts";
import { BadRequest } from "../../amplify/functions/configurations-shared/rules.ts";
import { fakeAws } from "./fakes.js";

process.env.HOME_VAULT_TABLE_NAME = "HomeVaultItems";
process.env.STORAGE_BUCKET_NAME = "bucket";
const H = "h-abcdefghjk";
const sha = (c) => c.repeat(64);
const photo = { sha256: sha("a"), size: 5, name: "panel open.png", contentType: "image/png", configVersion: `${H}-0001-0000`, thumb: true };
const doc = { sha256: sha("b"), size: 3, name: "checklist.md", contentType: "text/markdown", configVersion: `${H}-0001-0000` };

describe("home vault", () => {
  let f, v;
  beforeEach(() => {
    f = fakeAws();
    v = new HomeVault(f.clients);
  });
  const put = (home, file, body) => f.objects.set(`tenant/${home}/vault/originals/sha256/${file.sha256}.${file.name.split(".").pop()}`, body);

  it("says in a dry run what is new, and hands out write-once links", async () => {
    expect(kindOf("a.JPG")).toBe("photo");
    expect(kindOf("plan.pdf")).toBe("document");
    expect(kindOf("page.html")).toBe("other");
    const dry = await v.upload(H, [photo, doc, { ...doc, sha256: sha("c"), size: 6 * 1024 ** 3 }], true);
    expect(dry.files.map((x) => x.status)).toEqual(["new", "new", "too_large"]);
    expect(dry.files[0].url).toBeUndefined();
    const up = await v.upload(H, [photo], false);
    expect(up.files[0]).toMatchObject({ status: "new", headers: { "If-None-Match": "*" } });
    expect(up.files[0].thumbUrl).toMatch(/derived\/a+\/thumb\.webp$/);
    expect(f.signed[0].input).toMatchObject({ IfNoneMatch: "*", Key: `tenant/${H}/vault/originals/sha256/${sha("a")}.png` });
  });

  it("keeps a file once, and only after it arrived whole", async () => {
    await expect(v.commit(H, photo, "edge:e1")).rejects.toThrow(/nothing was uploaded/);
    put(H, photo, "12");
    await expect(v.commit(H, photo, "edge:e1")).rejects.toThrow(/2 bytes arrived, 5/);
    put(H, photo, "12345");
    expect((await v.commit(H, photo, "edge:e1")).status).toBe("ok");
    expect((await v.commit(H, photo, "edge:e1")).status).toBe("known");
    expect((await v.upload(H, [photo], true)).files[0].status).toBe("known");
    const [item] = await v.items(H);
    expect(item).toMatchObject({ kind: "photo", tags: [`${H}-0001-0000`], thumb: false, uploadedBy: "edge:e1" });
  });

  it("groups by configuration, moves a group on promote, and downloads documents", async () => {
    put(H, photo, "12345"); put(H, doc, "abc");
    await v.commit(H, { ...photo, configVersion: `${H}-p01` }, "edge:e1");
    await v.commit(H, doc, "edge:e1");
    expect((await v.items(H, `${H}-p01`)).map((i) => i.name)).toEqual(["panel open.png"]);
    expect(await v.regroup(H, `${H}-p01`, `${H}-0002-0000`)).toBe(1);
    expect((await v.items(H, `${H}-0002-0000`)).map((i) => i.name)).toEqual(["panel open.png"]);
    await expect(v.setGroup(H, sha("b"), "h-bbbbbbbbbb-0001-0000")).rejects.toThrow(BadRequest);

    expect((await v.setGroup(H, sha("b"), "")).tags).toEqual([]);

    await v.url(H, sha("b"));
    expect(f.signed.at(-1).input.ResponseContentDisposition).toBe('attachment; filename="checklist.md"');
    await v.url(H, sha("a"));
    expect(f.signed.at(-1).input.ResponseContentDisposition).toMatch(/^inline/);
  });

  it("tags several items with several versions, filters by a tag, and reads an older single group as a tag", async () => {
    put(H, photo, "12345"); put(H, doc, "abc");
    await v.commit(H, { ...photo, configVersion: undefined }, "edge:e1");
    await v.commit(H, doc, "edge:e1");
    // a row written before tags: one configVersion
    f.table("HomeVaultItems").get(JSON.stringify([H, sha("b")])).configVersion = `${H}-0001-0000`;
    delete f.table("HomeVaultItems").get(JSON.stringify([H, sha("b")])).tags;

    const r = await v.tag(H, [sha("a"), sha("b")], [`${H}-0001-0000`, `${H}-0002-0000`]);
    expect(r.map((x) => x.tags)).toEqual([[`${H}-0001-0000`, `${H}-0002-0000`], [`${H}-0001-0000`, `${H}-0002-0000`]]);
    expect(f.table("HomeVaultItems").get(JSON.stringify([H, sha("b")])).configVersion).toBeUndefined();
    await v.tag(H, [sha("b")], [], [`${H}-0002-0000`]);
    expect((await v.items(H, `${H}-0002-0000`)).map((i) => i.name)).toEqual(["panel open.png"]);
    expect((await v.items(H, `${H}-0001-0000`)).length).toBe(2);
    await expect(v.tag(H, [sha("a")], ["h-bbbbbbbbbb-0001-0000"])).rejects.toThrow(BadRequest);
    await expect(v.tag(H, [sha("c")], [`${H}-0001-0000`])).rejects.toThrow(/no item/);
    await expect(v.tag(H, [sha("a")], [])).rejects.toThrow(/which tags/);
  });
});
