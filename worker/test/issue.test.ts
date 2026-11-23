import { describe, expect, it } from "vitest";
import { buildIssueBody, issueTitle, newProposalId, parseIssueBody } from "../src/issue";
import { validateProposal } from "../src/validation";
import { VALID_PROPOSAL } from "./helpers";

const REPO = "mdainelli/justanothertcgapp-catalog";
const P = validateProposal({ ...VALID_PROPOSAL, description: undefined });
const ID = "p-20261123-deadbeef";
const U = `https://raw.githubusercontent.com/${REPO}/proposals/proposals/${ID}`;

describe("issue builder", () => {
  it("builds ids and titles", () => {
    expect(newProposalId(new Date("2026-11-23T23:59:00Z"), "deadbeef")).toBe(ID);
    expect(issueTitle(P)).toBe("Proposta: Charizard (it · base1 4)");
    expect(issueTitle({ ...P, setId: null, setName: "Promo X" })).toBe("Proposta: Charizard (it · Promo X 4)");
  });

  it("produces the exact body (front and back)", () => {
    const expected = `<!-- justanothertcgapp-proposal v1 -->
**Carta proposta**: Charizard — Set Base 4 (it)

Foto: [fronte](${U}/front.jpg) · [retro](${U}/back.jpg)

![fronte](${U}/front.jpg)

\`\`\`json proposal
{
  "formatVersion": 1,
  "lang": "it",
  "setId": "base1",
  "setName": "Set Base",
  "localId": "4",
  "name": "Charizard",
  "category": "Pokemon",
  "rarity": "Rara Holo",
  "illustrator": "Mitsuhiro Arita",
  "types": [
    "Fire"
  ],
  "hp": 120,
  "variants": {
    "normal": false,
    "reverse": false,
    "holo": true,
    "firstEdition": false
  },
  "proposalId": "${ID}",
  "images": {
    "front": "proposals/${ID}/front.jpg",
    "back": "proposals/${ID}/back.jpg"
  }
}
\`\`\`

Per approvare aggiungi l'etichetta \`approvata\`.
`;
    expect(buildIssueBody(P, ID, true, REPO)).toBe(expected);
  });

  it("omits the back link and uses null when there is no back photo", () => {
    const body = buildIssueBody(P, ID, false, REPO);
    expect(body).toContain(`Foto: [fronte](${U}/front.jpg)\n`);
    expect(body).not.toContain("retro");
    expect((parseIssueBody(body) as any).images).toEqual({ front: `proposals/${ID}/front.jpg`, back: null });
  });

  it("round-trips the json proposal block, even with nasty text", () => {
    const nasty = validateProposal({
      ...VALID_PROPOSAL,
      name: "Evil ``` @bob",
      description: "line1\n```\nline2 <!-- x -->",
    });
    const body = buildIssueBody(nasty, ID, true, REPO);
    expect(parseIssueBody(body)).toEqual({
      ...nasty,
      proposalId: ID,
      images: { front: `proposals/${ID}/front.jpg`, back: `proposals/${ID}/back.jpg` },
    });
    expect(body.split("\n")[1]).not.toContain("@bob");
  });
});
