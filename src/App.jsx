import { useState, useRef } from "react";

const MAX_DOCS = 14;

// N-cut bullet — the brand triangle
const NTriangle = ({ color = "currentColor", size = 10 }) => (
  <svg
    width={size * 2.5} height={size}
    viewBox="0 0 25 10"
    aria-hidden="true"
    style={{ flexShrink: 0, display: "inline-block" }}
  >
    <polygon fill={color} points="25,10 25,0 0,10" />
  </svg>
);

const ArrowRight = ({ style = {} }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle", marginLeft: 6, ...style }}>
    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ── FILE PARSING ─────────────────────────────────────────────────────────── */

function extractPlainTextFromXml(xmlText) {
  const textMatches = xmlText.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
  return textMatches
    .map(t => t.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, ""))
    .join(" ").replace(/\s+/g, " ").trim();
}

function parseDayLabelFromText(text, fallback) {
  const match = text.match(/(Day|day|Päivä|päivä)\s*\d+/);
  if (match) return match[0].trim();
  return fallback;
}

function parseFile(text, fileName) {
  const isXml = text.includes("<w:") || text.includes("<?xml");
  if (isXml) {
    const plainText = extractPlainTextFromXml(text);
    if (plainText.length > 20) return splitIntoDays(plainText, fileName);
    return [];
  }
  if (text.trim().length > 10) return splitIntoDays(text, fileName);
  return [];
}

function splitIntoDays(text, fileName) {
  const dayPattern = /(?:^|[\n\s])(?:Day|day|Päivä|päivä)\s*(\d+)\b/gi;
  const matches = [...text.matchAll(dayPattern)];
  if (matches.length >= 2) {
    return matches.map((m, i) => {
      const start = m.index;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      return { label: `Day ${m[1]}`, answers: [text.slice(start, end).trim()] };
    });
  }
  const label = parseDayLabelFromText(text, fileName.replace(/\.(doc|docx|txt)$/i, ""));
  return [{ label, answers: [text.trim()] }];
}

async function readDocx(file) {
  const buf = await file.arrayBuffer();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const fullText = decoder.decode(new Uint8Array(buf));
  const segments = fullText.split("<?xml");
  for (const seg of segments) {
    if (seg.includes("<w:body>")) return "<?xml" + seg;
  }
  return fullText;
}

/* ── PROMPTS ──────────────────────────────────────────────────────────────── */

function buildAnalysisPrompt(days, aspiration) {
  const count = Object.keys(days).length;
  const daysText = Object.entries(days).map(([label, answers]) =>
    `${label.toUpperCase()}\n${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
  ).join("\n\n");

  return `You are an expert in workflow automation, AI productivity, and helping professionals stay relevant in an AI-driven world.

This person has completed a ${count}-day self-reflection exercise as part of a programme called "Where Does Your Time Go". Each day they answered the same five questions covering both work and leisure. Analyse their responses and produce a clear, warm, and practical report.

Their aspiration — what they would attempt if they had the time and someone to show them how:
"${aspiration}"

Keep this aspiration in mind throughout. The goal is not to work directly on the aspiration, but to identify what is consuming their time so it can be freed up — making space for what matters to them.

Structure your response with these exact sections using ## for headings:

## What's draining your time
2 or 3 recurring patterns costing the most time or energy. Reference their actual words.

## What to automate or eliminate
2 or 3 tasks they could hand to AI tools or simply stop doing. Suggest a specific tool for each.

## What only you can do — protect this
What brings flow, joy, or unique human value. Tell them clearly: this is what to protect.

## Where AI could help you right now
3 specific, immediately actionable suggestions. Name the tool and describe the action.

## Your week in a sentence
One warm, honest sentence that captures the pattern of their week.

Keep your tone warm, direct, and encouraging. No jargon. This person is busy and not necessarily technical.

Their ${count}-day reflections:

${daysText}`;
}

function buildProjectPrompt(days, aspiration) {
  const count = Object.keys(days).length;
  const daysText = Object.entries(days).map(([label, answers]) =>
    `${label.toUpperCase()}\n${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
  ).join("\n\n");

  return `You are a creative AI coach on a programme called "Where Does Your Time Go".

This person's aspiration: "${aspiration}"

The goal is NOT to build toward this aspiration directly. The goal is to FREE UP TIME — so they can eventually get there.

Based on their ${count}-day reflection log, suggest 4 or 5 small AI projects they could attempt to eliminate or reduce the recurring tasks draining their time. Each should be startable in 30–60 minutes.

For each idea include:
— A short punchy name
— What it does in 1–2 sentences
— Which specific frustration from their log it addresses
— Difficulty: Beginner / Intermediate / Adventurous
— The tool or approach to start with (e.g. Claude, ChatGPT, Zapier, Make, Calendly)

End with one sentence that connects the time they could reclaim to their aspiration.

Their reflections:
${daysText}`;
}

async function callClaude(prompt) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("\n") || "Could not generate response.";
}

function parseSections(text) {
  const sections = {};
  const parts = text.split(/^## /m).filter(Boolean);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    if (newline === -1) continue;
    sections[part.slice(0, newline).trim()] = part.slice(newline + 1).trim();
  }
  return sections;
}

function parseProjects(text) {
  const projects = [];
  const footer = { text: "" };
  const lines = text.split("\n");
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
      if (current) projects.push(current);
      current = { name: trimmed.replace(/\*\*/g, ""), desc: "", why: "", difficulty: "", tool: "" };
    } else if (trimmed.match(/^#+\s/)) {
      if (current) projects.push(current);
      current = { name: trimmed.replace(/^#+\s/, ""), desc: "", why: "", difficulty: "", tool: "" };
    } else if (trimmed.startsWith("— ") || trimmed.startsWith("- ")) {
      const content = trimmed.replace(/^[—\-]\s*/, "");
      if (current) {
        if (content.toLowerCase().startsWith("difficulty:") || content.match(/^(beginner|intermediate|adventurous)/i)) {
          current.difficulty = content.replace(/^difficulty:\s*/i, "").split(/[,\/]/)[0].trim();
        } else if (content.toLowerCase().startsWith("tool") || content.toLowerCase().startsWith("start with")) {
          current.tool = content.replace(/^(tool[^:]*:|start with[^:]*:)\s*/i, "").trim();
        } else if (!current.desc) current.desc = content;
        else current.why = content;
      }
    } else if (current) {
      if (!current.desc) current.desc = trimmed;
      else if (!current.why) current.why = trimmed;
    } else if (trimmed.length > 20) footer.text = trimmed;
  }
  if (current) projects.push(current);

  const lastLine = lines.filter(l => l.trim() && !l.trim().startsWith("—") && !l.trim().startsWith("-") && !l.trim().startsWith("#") && !l.trim().startsWith("**")).pop();
  if (lastLine) footer.text = lastLine.trim();

  return { projects, footer: footer.text };
}

const DIFFICULTY_COLORS = {
  beginner:     { bg: "#e6f4d7", color: "#1e5200" },
  intermediate: { bg: "#fef3d0", color: "#7a4100" },
  adventurous:  { bg: "#fde8e8", color: "#8b1a1a" },
};
const diffStyle = (d = "") => DIFFICULTY_COLORS[d.toLowerCase()] || DIFFICULTY_COLORS.beginner;

/* ── APP ──────────────────────────────────────────────────────────────────── */

export default function App() {
  const [phase, setPhase] = useState("upload");
  const [docs, setDocs] = useState([]);
  const [aspiration, setAspiration] = useState("");
  const [inputMode, setInputMode] = useState("file");
  const [pasteText, setPasteText] = useState("");
  const [sections, setSections] = useState({});
  const [projects, setProjects] = useState([]);
  const [projectsFooter, setProjectsFooter] = useState("");
  const [rawAnalysis, setRawAnalysis] = useState("");
  const [rawProjects, setRawProjects] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const handleFiles = async (files) => {
    const incoming = Array.from(files).slice(0, MAX_DOCS - docs.length);
    const parsed = [];
    for (const file of incoming) {
      const ext = file.name.split(".").pop().toLowerCase();
      const text = ext === "docx" ? await readDocx(file) : await file.text();
      const entries = parseFile(text, file.name);
      for (const entry of entries) parsed.push({ ...entry, fileName: file.name });
    }
    if (parsed.length === 0) {
      setError("Could not extract reflection answers from the uploaded file(s). Try using the paste option instead.");
      return;
    }
    setError("");
    setDocs(prev => {
      const combined = [...prev, ...parsed];
      combined.sort((a, b) => {
        const numA = parseInt(a.label.match(/\d+/)?.[0] || "0");
        const numB = parseInt(b.label.match(/\d+/)?.[0] || "0");
        return numA - numB;
      });
      return combined.slice(0, MAX_DOCS);
    });
  };

  const addPastedText = () => {
    if (!pasteText.trim()) return;
    setDocs(prev => [...prev, ...splitIntoDays(pasteText, "Pasted text").map(e => ({ ...e, fileName: "pasted" }))].slice(0, MAX_DOCS));
    setPasteText("");
    setError("");
  };

  const removeDoc = (index) => setDocs(prev => prev.filter((_, i) => i !== index));

  const runAnalysis = async () => {
    if (docs.length === 0 || !aspiration.trim()) return;
    setError("");
    setPhase("loading");
    try {
      const dayMap = {};
      docs.forEach(d => { dayMap[d.label] = d.answers; });
      const [analysisText, projectText] = await Promise.all([
        callClaude(buildAnalysisPrompt(dayMap, aspiration)),
        callClaude(buildProjectPrompt(dayMap, aspiration))
      ]);
      setRawAnalysis(analysisText);
      setRawProjects(projectText);
      setSections(parseSections(analysisText));
      const { projects: p, footer: f } = parseProjects(projectText);
      setProjects(p);
      setProjectsFooter(f);
      setPhase("results");
    } catch (e) {
      setError("Something went wrong. Please try again.");
      setPhase("upload");
    }
  };

  const reset = () => {
    setDocs([]); setAspiration(""); setSections({});
    setProjects([]); setProjectsFooter(""); setRawAnalysis(""); setRawProjects("");
    setPhase("upload"); setError(""); setPasteText(""); setInputMode("file");
  };

  const S = {
    app:    { minHeight: "100vh", background: "#fff", color: "#230064", fontFamily: "var(--font-body)" },
    header: { padding: "16px 28px", borderBottom: "1px solid rgba(35,0,100,0.10)", display: "flex", alignItems: "center", justifyContent: "space-between" },
    logo:   { fontSize: 15, fontFamily: "var(--font-headline)", fontWeight: 400, color: "#230064", letterSpacing: "-0.01em" },
    badge:  { fontSize: 11, fontWeight: 700, color: "#230064", background: "#c8e1ff", padding: "4px 12px", borderRadius: 9999, letterSpacing: "0.18em", textTransform: "uppercase" },
    main:   { maxWidth: 660, margin: "0 auto", padding: "48px 24px" },
    h1:     { fontSize: 28, fontFamily: "var(--font-headline)", fontWeight: 400, color: "#230064", lineHeight: 1.05, letterSpacing: "-0.01em", marginBottom: 12 },
    body:   { fontSize: 16, lineHeight: 1.6, color: "rgba(35,0,100,0.65)", marginBottom: 24 },
    eyebrow: { fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(35,0,100,0.50)", marginBottom: 8, display: "block" },
    card:   { background: "#fff", border: "1px solid rgba(35,0,100,0.10)", borderRadius: 24, padding: "32px 36px", marginBottom: 20 },
    aspirationQ: { fontSize: 15, color: "#230064", lineHeight: 1.6, marginBottom: 14 },
    textarea: { width: "100%", background: "#f5f3fb", border: "1px solid rgba(35,0,100,0.10)", borderRadius: 12, padding: "14px 16px", color: "#230064", fontSize: 14, lineHeight: 1.7, resize: "vertical", minHeight: 90 },
    drop:   { border: "2px dashed rgba(35,0,100,0.15)", borderRadius: 16, padding: "36px 24px", textAlign: "center", cursor: "pointer", marginBottom: 16, transition: "border-color 160ms" },
    docPill: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#c8e1ff", border: "1px solid rgba(35,0,100,0.10)", borderRadius: 12, padding: "10px 16px", marginBottom: 8 },
    btnPrimary: { padding: "14px 32px", borderRadius: 9999, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "var(--font-body)", background: "#230064", color: "#fff", transition: "background 160ms", display: "inline-flex", alignItems: "center" },
    btnSmall:   { padding: "10px 20px", borderRadius: 9999, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)", background: "#ff3787", color: "#fff", transition: "background 160ms", display: "inline-flex", alignItems: "center" },
    btnOutline: { padding: "12px 24px", borderRadius: 9999, border: "2px solid #230064", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "var(--font-body)", background: "transparent", color: "#230064", transition: "all 160ms", display: "inline-flex", alignItems: "center" },
    errorBox: { background: "#fff0f4", border: "1px solid rgba(255,55,135,0.3)", borderRadius: 12, padding: "14px 18px", color: "#ff3787", fontSize: 14, marginBottom: 20 },
    aspirationBanner: { background: "#c8e1ff", border: "1px solid rgba(35,0,100,0.10)", borderRadius: 16, padding: "16px 20px", marginBottom: 24 },
    sectionHeading: { fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, color: "#ff3787", marginBottom: 8, display: "block" },
    sectionBody: { fontSize: 15, lineHeight: 1.85, color: "#230064" },
    weekSentence: { fontSize: 17, color: "#230064", lineHeight: 1.6, borderLeft: "3px solid #ff3787", paddingLeft: 16 },
    divider: { borderTop: "1px solid rgba(35,0,100,0.10)", margin: "24px 0" },
    projectName: { fontSize: 15, fontWeight: 700, color: "#230064", marginBottom: 6 },
    projectDesc: { fontSize: 14, color: "rgba(35,0,100,0.65)", lineHeight: 1.7, marginBottom: 6 },
    projectWhy:  { fontSize: 13, color: "rgba(35,0,100,0.50)", lineHeight: 1.5, marginBottom: 10 },
    pills: { display: "flex", gap: 6, flexWrap: "wrap" },
    pill: (bg, color) => ({ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 9999, background: bg, color }),
    footer: { fontSize: 13, color: "rgba(35,0,100,0.50)", lineHeight: 1.6, marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(35,0,100,0.10)" },
    tabRow: { display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid rgba(35,0,100,0.10)" },
    tab: (active) => ({
      flex: 1, padding: "12px 16px", textAlign: "center", fontSize: 13, fontWeight: active ? 700 : 400,
      cursor: "pointer", background: "transparent", border: "none", fontFamily: "var(--font-body)",
      borderBottom: `2px solid ${active ? "#ff3787" : "transparent"}`,
      color: active ? "#230064" : "rgba(35,0,100,0.50)",
      marginBottom: -1, transition: "all 160ms",
    }),
  };

  // ── LOADING ───────────────────────────────────────────────────────────────────

  if (phase === "loading") return (
    <div style={S.app}>
      <div style={S.header}>
        <span style={S.logo}>Where Does Your Time Go</span>
        <span style={S.badge}>Analyser</span>
      </div>
      <div style={{ ...S.main, textAlign: "center", paddingTop: 120 }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 32 }}>
          {[0,1,2,3,4].map(i => <NTriangle key={i} color={i % 2 === 0 ? "#230064" : "#ff3787"} size={12} />)}
        </div>
        <h1 style={{ ...S.h1, textAlign: "center" }}>Reading your reflections.</h1>
        <p style={{ ...S.body, textAlign: "center" }}>Finding patterns, opportunities, and things worth protecting.</p>
      </div>
    </div>
  );

  // ── RESULTS ───────────────────────────────────────────────────────────────────

  if (phase === "results") {
    const SECTION_KEYS = [
      "What's draining your time",
      "What to automate or eliminate",
      "What only you can do — protect this",
      "Where AI could help you right now",
      "Your week in a sentence",
    ];

    return (
      <div style={S.app}>
        <div style={S.header}>
          <span style={S.logo}>Where Does Your Time Go</span>
          <span style={{ ...S.badge, background: "#ff3787", color: "#fff" }}>Your analysis</span>
        </div>
        <div style={S.main}>
          <h1 style={S.h1}>Your analysis.</h1>
          <p style={{ ...S.body, marginBottom: 28 }}>Based on {docs.length} day{docs.length > 1 ? "s" : ""} of reflections.</p>

          <div style={S.aspirationBanner}>
            <span style={{ ...S.eyebrow, color: "#230064" }}>Your aspiration</span>
            <p style={{ fontSize: 15, color: "#230064", lineHeight: 1.7, margin: 0 }}>"{aspiration}"</p>
          </div>

          <div style={S.card}>
            {SECTION_KEYS.map((key, i) => {
              const body = sections[key] || Object.entries(sections).find(([k]) => k.toLowerCase().includes(key.toLowerCase().split(" ")[1]))?.[1] || "";
              if (!body) return null;
              const isLast = i === SECTION_KEYS.length - 1;
              return (
                <div key={key} style={isLast ? {} : { marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid rgba(35,0,100,0.10)" }}>
                  <span style={S.sectionHeading}>{key}</span>
                  {key === "Your week in a sentence"
                    ? <div style={S.weekSentence}>{body.replace(/^[""“]|[""”]$/g, "")}</div>
                    : <div style={S.sectionBody}>{body}</div>
                  }
                </div>
              );
            })}
            {Object.keys(sections).length === 0 && (
              <div style={{ fontSize: 15, lineHeight: 1.9, color: "#230064", whiteSpace: "pre-wrap" }}>{rawAnalysis}</div>
            )}
          </div>

          <div style={S.card}>
            <span style={{ ...S.sectionHeading }}>Projects to free up your time</span>
            <p style={{ fontSize: 14, color: "rgba(35,0,100,0.50)", lineHeight: 1.6, marginBottom: 24 }}>
              These ideas don't work toward your aspiration directly — they clear the path.
            </p>

            {projects.length > 0 ? projects.map((p, i) => (
              <div key={i} style={i < projects.length - 1 ? { marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid rgba(35,0,100,0.10)" } : {}}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <NTriangle color="#ff3787" size={9} />
                  <span style={S.projectName}>{p.name}</span>
                </div>
                {p.desc && <div style={S.projectDesc}>{p.desc}</div>}
                {p.why && <div style={S.projectWhy}>{p.why}</div>}
                <div style={S.pills}>
                  {p.difficulty && (() => { const ds = diffStyle(p.difficulty); return <span style={S.pill(ds.bg, ds.color)}>{p.difficulty}</span>; })()}
                  {p.tool && <span style={S.pill("#c8e1ff", "#230064")}>{p.tool}</span>}
                </div>
              </div>
            )) : (
              <div style={{ fontSize: 15, lineHeight: 1.9, color: "#230064", whiteSpace: "pre-wrap" }}>{rawProjects}</div>
            )}

            {projectsFooter && <div style={S.footer}>{projectsFooter}</div>}
          </div>

          <div style={{ textAlign: "center", paddingBottom: 48 }}>
            <button style={S.btnOutline} onClick={reset}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ marginRight: 6 }}>
                <path d="M13 8H3M7 12l-4-4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Start a new analysis
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── UPLOAD ────────────────────────────────────────────────────────────────────

  const canAnalyse = docs.length > 0 && aspiration.trim();

  return (
    <div style={S.app}>
      <div style={S.header}>
        <span style={S.logo}>Where Does Your Time Go</span>
        <span style={S.badge}>Analyser</span>
      </div>
      <div style={S.main}>
        <h1 style={S.h1}>Let's look at your week.</h1>
        <p style={S.body}>Answer this one aspirational question first. Then add your daily reflections — upload your files or paste your answers directly.</p>

        {error && <div style={S.errorBox}>{error}</div>}

        <div style={S.card}>
          <p style={S.aspirationQ}>What is one thing you would attempt to create or do, if you knew you had the time and someone to show you how?</p>
          <textarea
            style={S.textarea}
            placeholder="Write your answer here — a sentence or two is enough…"
            value={aspiration}
            onChange={e => setAspiration(e.target.value)}
          />
        </div>

        <div style={S.tabRow}>
          <button style={S.tab(inputMode === "file")} onClick={() => setInputMode("file")}>Upload files</button>
          <button style={S.tab(inputMode === "paste")} onClick={() => setInputMode("paste")}>Paste text</button>
        </div>

        {inputMode === "file" && (
          <div
            style={{ ...S.drop, borderColor: docs.length > 0 ? "#ff3787" : "rgba(35,0,100,0.15)" }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          >
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 10 }}>
              <NTriangle color="rgba(35,0,100,0.25)" size={12} />
            </div>
            <p style={{ fontSize: 15, color: "rgba(35,0,100,0.65)", margin: 0 }}>
              {docs.length === 0
                ? "Click to upload your reflection documents"
                : docs.length >= MAX_DOCS
                  ? `Maximum of ${MAX_DOCS} documents reached`
                  : `${docs.length} entr${docs.length > 1 ? "ies" : "y"} loaded — click to add more`}
            </p>
            <p style={{ fontSize: 12, color: "rgba(35,0,100,0.40)", margin: "6px 0 0", letterSpacing: "0.05em" }}>
              .doc, .docx, or .txt — up to {MAX_DOCS} entries
            </p>
            <input ref={fileInputRef} type="file" accept=".doc,.docx,.txt" multiple style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />
          </div>
        )}

        {inputMode === "paste" && (
          <div style={S.card}>
            <p style={{ fontSize: 13, color: "rgba(35,0,100,0.50)", lineHeight: 1.6, marginBottom: 12 }}>
              Paste your reflection answers below. Include "Day 1", "Day 2" etc. as headers and they will be separated automatically.
            </p>
            <textarea
              style={{ ...S.textarea, minHeight: 200 }}
              placeholder={"Day 1\nToday I spent most of my time on…\n\nDay 2\n…"}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
            />
            <div style={{ marginTop: 12 }}>
              <button
                style={{ ...S.btnSmall, opacity: pasteText.trim() ? 1 : 0.35, cursor: pasteText.trim() ? "pointer" : "not-allowed" }}
                onClick={addPastedText}
                disabled={!pasteText.trim()}
              >
                Add to analysis<ArrowRight />
              </button>
            </div>
          </div>
        )}

        {docs.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            {docs.map((doc, i) => (
              <div key={i} style={S.docPill}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <NTriangle color="#230064" size={9} />
                  <div>
                    <div style={{ fontSize: 14, color: "#230064", fontWeight: 700 }}>{doc.label}</div>
                    <div style={{ fontSize: 11, color: "rgba(35,0,100,0.50)", letterSpacing: "0.05em" }}>
                      {doc.answers.length} {doc.answers.length !== 1 ? "entries" : "entry"}
                      {doc.fileName !== "pasted" && ` — ${doc.fileName}`}
                    </div>
                  </div>
                </div>
                <button
                  style={{ padding: "5px 14px", borderRadius: 9999, border: "1px solid rgba(255,55,135,0.3)", background: "rgba(255,55,135,0.06)", color: "#ff3787", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}
                  onClick={() => removeDoc(i)}
                >Remove</button>
              </div>
            ))}
          </div>
        )}

        {docs.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <button
              style={{ ...S.btnPrimary, opacity: canAnalyse ? 1 : 0.35, cursor: canAnalyse ? "pointer" : "not-allowed" }}
              onClick={runAnalysis}
              disabled={!canAnalyse}
            >
              Analyse {docs.length} day{docs.length > 1 ? "s" : ""}<ArrowRight />
            </button>
            {!aspiration.trim() && (
              <span style={{ fontSize: 13, color: "rgba(35,0,100,0.50)" }}>Answer the question above to continue</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
