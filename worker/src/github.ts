import { HttpError } from "./types";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const API = "https://api.github.com";
const BRANCH = "proposals";

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export class GitHub {
  constructor(
    private repo: string,
    private token: string,
    private fetchFn: FetchFn,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(`${API}/repos/${this.repo}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "justanothertcgapp-proposals",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new HttpError(502, "github_error");
    }
    return res;
  }

  private async ok(res: Response): Promise<Response> {
    if (!res.ok) throw new HttpError(502, "github_error");
    return res;
  }

  /** Creates the `proposals` branch from `main` when it does not exist. */
  async ensureBranch(): Promise<void> {
    const ref = await this.call("GET", `/git/ref/heads/${BRANCH}`);
    if (ref.ok) return;
    if (ref.status !== 404) throw new HttpError(502, "github_error");
    const main = await this.ok(await this.call("GET", "/git/ref/heads/main"));
    const sha = ((await main.json()) as { object?: { sha?: string } }).object?.sha;
    if (!sha) throw new HttpError(502, "github_error");
    const created = await this.call("POST", "/git/refs", { ref: `refs/heads/${BRANCH}`, sha });
    // 422 = someone created it concurrently: fine.
    if (!created.ok && created.status !== 422) throw new HttpError(502, "github_error");
  }

  async putFile(path: string, bytes: Uint8Array, message: string): Promise<void> {
    await this.ok(await this.call("PUT", `/contents/${path}`, { message, content: toBase64(bytes), branch: BRANCH }));
  }

  async createIssue(title: string, body: string, labels: string[]): Promise<{ number: number; html_url: string }> {
    const res = await this.ok(await this.call("POST", "/issues", { title, body, labels }));
    const j = (await res.json()) as { number?: number; html_url?: string };
    if (typeof j.number !== "number" || typeof j.html_url !== "string") throw new HttpError(502, "github_error");
    return { number: j.number, html_url: j.html_url };
  }
}
