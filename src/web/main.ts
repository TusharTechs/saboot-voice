import { CallController, type TimelineEntry } from "../harness/controller.ts";
import type { Capture, Field } from "../harness/entities.ts";
import type { Mode } from "../harness/session.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let mode: Mode = "saboot";
let pc: RTCPeerConnection | null = null;
let mic: MediaStream | null = null;
let ctl: CallController | null = null;
let agentLi: HTMLLIElement | null = null;
let callerLi: HTMLLIElement | null = null;
let lastSpeechStop = 0;

const FIELD_LABELS: Record<Field, string> = {
  mobile: "Mobile", customer_id: "Customer ID", locality: "Locality", pincode: "Pincode", name: "Name",
};

// ---------- tabs ----------
for (const [tab, view] of [["tab-call", "view-call"], ["tab-results", "view-results"]] as const) {
  $(tab).addEventListener("click", () => {
    for (const [t, v] of [["tab-call", "view-call"], ["tab-results", "view-results"]] as const) {
      $(t).setAttribute("aria-selected", String(t === tab));
      $(v).hidden = v !== view;
    }
    if (view === "view-results") loadResults();
  });
}

// ---------- mode ----------
for (const b of document.querySelectorAll<HTMLButtonElement>(".mode button")) {
  b.addEventListener("click", () => {
    if (pc) return;
    mode = b.dataset.mode as Mode;
    for (const o of document.querySelectorAll(".mode button")) o.setAttribute("aria-checked", String(o === b));
  });
}

// ---------- voice (remembered per browser) ----------
try {
  const saved = localStorage.getItem("saboot-voice");
  if (saved) ($("voice") as HTMLSelectElement).value = saved;
} catch {
  /* storage unavailable */
}
$("voice").addEventListener("change", (e) => {
  try {
    localStorage.setItem("saboot-voice", (e.target as HTMLSelectElement).value);
  } catch {
    /* storage unavailable */
  }
});

// ---------- call ----------
$("call").addEventListener("click", () => (pc ? hangUp() : startCall().catch((e) => fail(e))));

function setStatus(text: string) {
  $("status").textContent = text;
}
function fail(e: unknown) {
  setStatus(`Couldn't start the call: ${(e as Error).message}`);
  hangUp();
}

async function startCall() {
  resetUi();
  setStatus("Connecting…");
  const voice = ($("voice") as HTMLSelectElement).value;
  let r = await fetch(`/api/session?mode=${mode}&voice=${voice}`, { method: "POST", headers: { "x-demo-code": accessCode() } });
  if (r.status === 401) {
    const code = await askForCode();
    r = await fetch(`/api/session?mode=${mode}&voice=${voice}`, { method: "POST", headers: { "x-demo-code": code } });
  }
  const sess = await r.json();
  if (!r.ok) throw new Error(sess.error ?? `session ${r.status}`);

  pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  pc.ontrack = (e) => (audio.srcObject = e.streams[0]);
  mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  pc.addTrack(mic.getTracks()[0], mic);
  const dc = pc.createDataChannel("oai-events");
  const send = (e: Record<string, unknown>) => dc.readyState === "open" && dc.send(JSON.stringify(e));

  ctl = new CallController(mode, send, {
    onTimeline: addTimeline,
    onCapture: showCapture,
    onAgentText: agentText,
    onUserText: callerText,
  });

  dc.onopen = () => {
    setStatus(mode === "saboot" ? "Live · Saboot harness on" : "Live · base model");
    send({ type: "response.create", response: { instructions: "Greet the caller in Hinglish as LineOne Fibre support and ask what the problem is. One short sentence." } });
  };
  dc.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === "input_audio_buffer.speech_stopped") lastSpeechStop = performance.now();
    if (ev.type === "response.created" && lastSpeechStop) {
      $("latency").textContent = `${((performance.now() - lastSpeechStop) / 1000).toFixed(2)} s`;
      lastSpeechStop = 0;
    }
    ctl?.handle(ev);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const sdp = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offer.sdp,
    headers: { Authorization: `Bearer ${sess.value}`, "Content-Type": "application/sdp" },
  });
  if (!sdp.ok) throw new Error(`realtime ${sdp.status}`);
  await pc.setRemoteDescription({ type: "answer", sdp: await sdp.text() });

  $("call").classList.add("live");
  $("call-label").textContent = "End call";
  for (const b of document.querySelectorAll<HTMLButtonElement>(".mode button")) b.disabled = true;
  ($("voice") as HTMLSelectElement).disabled = true;
}

/** Demo access code: from ?code= in the link, or remembered in this browser. */
function accessCode(): string {
  const fromUrl = new URLSearchParams(location.search).get("code");
  try {
    if (fromUrl) localStorage.setItem("saboot-code", fromUrl);
    return fromUrl ?? localStorage.getItem("saboot-code") ?? "";
  } catch {
    return fromUrl ?? "";
  }
}

function askForCode(): Promise<string> {
  return new Promise((resolve) => {
    setStatus("This demo needs an access code.");
    const form = document.createElement("form");
    form.className = "code-form";
    form.innerHTML = `<label for="code-input">Access code</label><input id="code-input" autocomplete="off" required /><button type="submit">Continue</button>`;
    $("status").after(form);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = (form.querySelector("input") as HTMLInputElement).value.trim();
      try {
        localStorage.setItem("saboot-code", v);
      } catch {
        /* private mode */
      }
      form.remove();
      setStatus("Connecting…");
      resolve(v);
    });
    (form.querySelector("input") as HTMLInputElement).focus();
  });
}

function hangUp() {
  pc?.close();
  pc = null;
  mic?.getTracks().forEach((t) => t.stop());
  mic = null;
  $("call").classList.remove("live");
  $("call-label").textContent = "Start call";
  for (const b of document.querySelectorAll<HTMLButtonElement>(".mode button")) b.disabled = false;
  ($("voice") as HTMLSelectElement).disabled = false;
  if (ctl) setStatus("Call ended. Switch mode and call again to compare.");
}

// ---------- rendering ----------
function resetUi() {
  $("transcript").replaceChildren();
  $("timeline").replaceChildren();
  $("captures").replaceChildren();
  $("latency").textContent = "–";
  agentLi = callerLi = null;
}

function bubble(who: "agent" | "caller") {
  const li = document.createElement("li");
  li.className = who;
  const small = document.createElement("small");
  small.textContent = who === "agent" ? "Saboot agent" : "You";
  li.append(small, document.createElement("span"));
  $("transcript").append(li);
  li.scrollIntoView({ block: "end" });
  return li;
}

function agentText(delta: string, done: boolean) {
  if (!agentLi) agentLi = bubble("agent");
  agentLi.querySelector("span")!.textContent += delta;
  if (done) agentLi = null;
}

function callerText(text: string, final: boolean) {
  if (!callerLi) callerLi = bubble("caller");
  const span = callerLi.querySelector("span")!;
  if (final) {
    span.textContent = text;
    callerLi.classList.remove("partial");
    callerLi = null;
  } else {
    span.textContent += text;
    callerLi.classList.add("partial");
  }
}

function addTimeline(e: TimelineEntry) {
  if (e.kind === "agent_text" || e.kind === "transcript") return;
  const li = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = `${(e.t / 1000).toFixed(1)}s`;
  const span = document.createElement("span");
  span.className = e.kind;
  const label: Record<string, string> = {
    speech_start: "Caller speaking", speech_stop: "Pause", wait: "Keep listening: ", respond: "Answer: ",
    agent_start: "Agent took the turn", capture: "Captured ", error: "Error: ",
  };
  span.textContent = (label[e.kind] ?? "") + (["wait", "respond", "capture", "error"].includes(e.kind) ? e.text : "");
  li.append(time, span);
  $("timeline").append(li);
  li.scrollIntoView({ block: "end" });
}

function showCapture(c: Capture & { raw: string }) {
  const id = `cap-${c.field}`;
  document.getElementById(id + "-dt")?.remove();
  document.getElementById(id)?.remove();
  const dt = document.createElement("dt");
  dt.id = id + "-dt";
  dt.textContent = FIELD_LABELS[c.field];
  const dd = document.createElement("dd");
  dd.id = id;
  const val = document.createElement("span");
  val.textContent = c.ok ? c.readback ?? c.value ?? "" : c.heard ?? "—";
  const pill = document.createElement("span");
  pill.className = `pill ${c.ok ? (c.warning ? "warn" : "ok") : "bad"}`;
  pill.textContent = c.ok ? (c.warning ? "check" : "valid") : "asking again";
  dd.append(val, pill);
  if (!c.ok || c.warning) {
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = c.problem ?? c.warning ?? "";
    dd.append(note);
  }
  $("captures").append(dt, dd);
}

// ---------- results ----------
async function loadResults() {
  let data: any = null;
  for (const url of ["./summary.json", "/api/results"]) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        data = await r.json();
        if (data?.modes) break;
      }
    } catch {
      /* try next */
    }
  }
  const head = $("results-head");
  if (!data?.modes) {
    head.innerHTML = "<h2>No results yet</h2><p>Run <code>npm run clips</code>, <code>npm run eval</code> and <code>npm run report</code>.</p>";
    return;
  }
  const b = data.modes.base, s = data.modes.saboot;
  head.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = `${data.clips} caller recordings, played into ${data.model} twice`;
  const p = document.createElement("p");
  p.textContent = "Once as the model ships (semantic turn detection, values taken as written), once behind the Saboot harness. Same audio, same model, same voice, same prompt.";
  head.append(h, p);
  const hb = data.heldOut?.base, hs = data.heldOut?.saboot;
  if (hb && hs && data.heldOutClips) {
    const ho = document.createElement("p");
    ho.className = "heldout";
    ho.textContent =
      `On the ${data.heldOutClips} held-out clips, written after tuning and never used for it: ` +
      `caller cut off ${hb.cutOffRate}% → ${hs.cutOffRate}%, details captured exactly right ${hb.captureAccuracy}% → ${hs.captureAccuracy}%, ` +
      `median reply time ${hb.medianReplyLatencyMs} → ${hs.medianReplyLatencyMs} ms.`;
    head.append(ho);
  }

  const cards = $("results-cards");
  cards.replaceChildren(
    card("Caller cut off mid-sentence", b?.cutOffRate, s?.cutOffRate, "%", true, `${b?.cutOffs}/${b?.runs}`, `${s?.cutOffs}/${s?.runs}`),
    card("Details captured exactly right", b?.captureAccuracy, s?.captureAccuracy, "%", false, `${b?.captured}/${b?.capturable}`, `${s?.captured}/${s?.capturable}`),
    card("Median reply time after caller stops", b?.medianReplyLatencyMs, s?.medianReplyLatencyMs, " ms", true),
  );

  const table = $("results-table") as HTMLTableElement;
  table.innerHTML = "<thead><tr><th>Clip</th><th>Listen</th><th>Should capture</th><th>Base model</th><th>Saboot</th></tr></thead>";
  const tb = document.createElement("tbody");
  for (const c of data.perClip) {
    const tr = document.createElement("tr");
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
    const cell = (m: string) => {
      const rs = c.runs[m] ?? [];
      if (!rs.length) return "–";
      return rs
        .map((r: any) => {
          const parts = [r.cutOff ? "✂ cut off" : "waited"];
          if (c.expect) parts.push(`${r.captured ? esc(r.captured) : "nothing"} ${r.correct ? "✓" : "✗"}`);
          return `<span class="run">${parts.join(" · ")}</span>`;
        })
        .join("");
    };
    const held = c.id.startsWith("x") ? '<span class="tag">held-out</span>' : "";
    tr.innerHTML = `<td class="mono">${c.id}${held}</td><td><audio controls preload="none" src="./clips/${c.id}.wav"></audio></td><td class="mono">${c.expect ?? "(no detail; cut-off only)"}</td><td class="mono">${cell("base")}</td><td class="mono">${cell("saboot")}</td>`;
    tb.append(tr);
  }
  table.append(tb);
}

function card(title: string, base: number | null, ours: number | null, unit: string, lowerIsBetter: boolean, bNote = "", sNote = "") {
  const el = document.createElement("div");
  el.className = "card";
  const h = document.createElement("h3");
  h.textContent = title + (lowerIsBetter ? " (lower is better)" : "");
  el.append(h);
  const max = Math.max(base ?? 0, ours ?? 0, unit === "%" ? 100 : 1);
  for (const [label, v, note, cls] of [["Base", base, bNote, "base"], ["Saboot", ours, sNote, "saboot"]] as const) {
    const row = document.createElement("div");
    row.className = `bar ${cls}`;
    row.innerHTML = `<span>${label}</span><span class="track"><span class="fill" style="width:${((v ?? 0) / max) * 100}%"></span></span><b>${v ?? "–"}${v === null ? "" : unit}</b>`;
    if (note) row.title = note;
    el.append(row);
  }
  return el;
}
