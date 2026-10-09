export type Usage = { input: number; output: number; reasoning: number; cacheRead: number; cost: number };
export type RunResult = { text: string; sessionId: string | null; usage: Usage | null };

type OpenCodeEvent = {
  type: string;
  sessionID?: string;
  part?: {
    type?: string;
    text?: string;
    cost?: number;
    tokens?: { input: number; output: number; reasoning: number; cache: { read: number } };
  };
};

export async function runOpenCode(opts: {
  prompt: string;
  model: string;
  variant?: string;
  sessionId?: string | null;
  cwd: string;
  timeoutMs?: number;
}): Promise<RunResult> {
  const args = ["opencode", "run", "--format", "json", "-m", opts.model];
  if (opts.variant) args.push("--variant", opts.variant);
  if (opts.sessionId) args.push("-s", opts.sessionId);
  args.push(opts.prompt);

  const proc = Bun.spawn(args, { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 120_000);

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  if (code !== 0) {
    throw new Error(`opencode salió con código ${code}: ${stderr.slice(0, 500)}`);
  }

  let text = "";
  let sessionId: string | null = null;
  let usage: Usage | null = null;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let ev: OpenCodeEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.sessionID) sessionId = ev.sessionID;
    if (ev.type === "text" && ev.part?.text) text += ev.part.text;
    if (ev.type === "step_finish" && ev.part?.tokens) {
      const t = ev.part.tokens;
      usage ??= { input: 0, output: 0, reasoning: 0, cacheRead: 0, cost: 0 };
      usage.input += t.input;
      usage.output += t.output;
      usage.reasoning += t.reasoning;
      usage.cacheRead += t.cache.read;
      usage.cost += ev.part.cost ?? 0;
    }
  }

  if (!text.trim()) throw new Error("opencode no devolvió texto");
  return { text: text.trim(), sessionId, usage };
}
