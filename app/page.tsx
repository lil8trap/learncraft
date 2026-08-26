"use client";

import { ChangeEvent, DragEvent, FormEvent, useMemo, useState } from "react";
import { extractDocument, formatFileSize, MAX_STUDY_CHARS } from "@/lib/extract-document";

type Mode = "summary" | "flashcards" | "quiz" | "plan" | "chat";
type Difficulty = "Quick" | "Standard" | "Deep";
type Flashcard = { front: string; back: string };
type QuizQuestion = { prompt: string; options: string[]; answer: number; explanation: string };
type PlanStep = { time: string; title: string; description: string };
type StudyKit = { summary: string[]; keyTerms: string[]; flashcards: Flashcard[]; quiz: QuizQuestion[]; plan: PlanStep[]; studyTip: string };
type GenerationStatus = "idle" | "loading" | "ai" | "fallback";
type ImportedFile = { name: string; size: number; pageCount?: number };
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; mode?: "ai" | "local" };

const SAMPLE_NOTES = `Binary Search Trees (BST)
A binary search tree stores smaller values in the left subtree and larger values in the right subtree. Search, insertion, and deletion are O(log n) on average, but O(n) when the tree becomes skewed.

Tree traversals
Inorder traversal visits left, root, right and returns BST values in sorted order. Preorder visits root, left, right. Postorder visits left, right, root. Breadth-first search uses a queue and visits nodes level by level.

AVL Trees
An AVL tree is a self-balancing BST. Every node has a balance factor of -1, 0, or 1. An LL imbalance needs a right rotation; RR needs a left rotation. LR needs a left rotation followed by a right rotation. RL needs a right rotation followed by a left rotation.

Heaps
A max heap is a complete binary tree where every parent is at least as large as its children. In a one-indexed array, the left child is 2i, the right child is 2i + 1, and the parent is floor(i/2). Insertion and deletion are O(log n), while finding the maximum is O(1).`;

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "been", "before", "being", "between", "both", "but", "can", "each", "every", "from", "have", "into", "more", "most", "not", "only", "other", "over", "same", "than", "that", "the", "their", "then", "there", "these", "they", "this", "through", "under", "uses", "using", "very", "when", "where", "which", "while", "with", "your",
]);

function sentencesFrom(text: string) {
  return text.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 22);
}

function keyTerms(text: string) {
  const counts = new Map<string, number>();
  const display = new Map<string, string>();
  const words = text.match(/[A-Za-z][A-Za-z-]{2,}/g) ?? [];
  words.forEach((word) => {
    const key = word.toLowerCase();
    if (STOP_WORDS.has(key)) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!display.has(key)) display.set(key, word);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, 8).map(([word]) => display.get(word) ?? word);
}

function createSummary(text: string) {
  const sentences = sentencesFrom(text);
  const terms = keyTerms(text).map((term) => term.toLowerCase());
  return sentences.map((sentence, index) => ({ sentence, index, score: terms.reduce((total, term) => total + (sentence.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score).slice(0, Math.min(4, sentences.length)).sort((a, b) => a.index - b.index).map((item) => item.sentence);
}

function createFlashcards(text: string): Flashcard[] {
  const sentences = sentencesFrom(text);
  const cards: Flashcard[] = [];
  for (const sentence of sentences) {
    const definition = sentence.match(/^(.{2,45}?)\s+(?:is|are|means|stores|uses|visits|needs)\s+(.+)$/i);
    if (definition) cards.push({ front: `What should you remember about ${definition[1].trim()}?`, back: sentence });
    else if (/O\([^)]+\)/.test(sentence)) cards.push({ front: "What is the key time-complexity fact?", back: sentence });
    if (cards.length === 6) break;
  }
  if (cards.length < 3) return sentences.slice(0, 5).map((sentence, index) => ({ front: `Explain key idea ${index + 1} in your own words.`, back: sentence }));
  return cards;
}

function createQuiz(text: string): QuizQuestion[] {
  const lower = text.toLowerCase();
  const questions: QuizQuestion[] = [];
  if (lower.includes("inorder")) questions.push({ prompt: "Which order describes an inorder traversal?", options: ["Root, left, right", "Left, root, right", "Left, right, root", "Level by level"], answer: 1, explanation: "Inorder traversal visits the left subtree, then the root, then the right subtree." });
  if (lower.includes("breadth-first") || lower.includes("queue")) questions.push({ prompt: "Which data structure powers breadth-first search?", options: ["Stack", "Priority heap", "Queue", "Hash table"], answer: 2, explanation: "A queue preserves level-by-level visiting order in breadth-first search." });
  if (lower.includes("avl") || lower.includes("rotation")) questions.push({ prompt: "How is an LL imbalance repaired in an AVL tree?", options: ["Left rotation", "Right rotation", "Two left rotations", "No rotation"], answer: 1, explanation: "An LL imbalance is corrected with one right rotation." });
  if (lower.includes("heap")) questions.push({ prompt: "In a one-indexed heap, where is the right child of index i?", options: ["2i", "i + 1", "2i + 1", "floor(i/2)"], answer: 2, explanation: "For a one-indexed heap, left = 2i and right = 2i + 1." });
  if (lower.includes("skewed") || lower.includes("binary search tree")) questions.push({ prompt: "What is the worst-case search time in a skewed BST?", options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"], answer: 2, explanation: "A skewed BST behaves like a linked list, so search can take O(n)." });
  if (questions.length < 3) questions.push(...keyTerms(text).slice(0, 3 - questions.length).map((term, index) => ({ prompt: "Which term appears as a key idea in your notes?", options: ["Unrelated concept", term, "None of these", `Example ${index + 1}`], answer: 1, explanation: `${term} was identified as a recurring concept in the source material.` })));
  return questions.slice(0, 5);
}

function localDocumentAnswer(question: string, text: string) {
  const questionTerms = (question.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((word) => !STOP_WORDS.has(word));
  const candidates = sentencesFrom(text).map((sentence, index) => ({
    sentence,
    index,
    score: questionTerms.reduce((total, term) => total + (sentence.toLowerCase().includes(term) ? 2 : 0), 0),
  }));
  const lowerQuestion = question.toLowerCase();
  if (lowerQuestion.includes("hardest") || lowerQuestion.includes("explain simply")) {
    const summary = createSummary(text).slice(0, 2);
    return summary.length
      ? `A simple way to understand the central idea is: ${summary.join(" ")}`
      : "I could not find enough complete information in the source to explain it yet.";
  }
  if (lowerQuestion.includes("quiz") || lowerQuestion.includes("test me")) {
    const firstCard = createFlashcards(text)[0];
    return firstCard ? `${firstCard.front}\n\nTry answering without looking back. When you are ready, check your source material for: ${firstCard.back}` : "I could not find enough complete statements in the source to create a question.";
  }
  if (lowerQuestion.includes("memorize") || lowerQuestion.includes("key concept") || lowerQuestion.includes("important")) {
    const terms = keyTerms(text).slice(0, 6);
    const summary = createSummary(text).slice(0, 2);
    return `Focus on these recurring concepts: ${terms.join(", ") || "the main definitions in your source"}.\n\n${summary.join(" ")}`;
  }
  if (lowerQuestion.includes("compare") && (lowerQuestion.includes("concept") || lowerQuestion.includes("idea"))) {
    const summary = createSummary(text).slice(0, 3);
    return summary.length
      ? `These are the main ideas to compare:\n\n${summary.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : "I could not identify enough distinct ideas to compare in this source.";
  }
  const matches = candidates.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 2).filter((item) => item.score > 0);
  if (!matches.length) {
    return "I couldn’t find that answer in your source material. Try asking about a concept, definition, or example that appears in the document.";
  }
  return `Based on your source material: ${matches.map((item) => item.sentence).join(" ")}`;
}

export default function Home() {
  const [notes, setNotes] = useState(SAMPLE_NOTES);
  const [source, setSource] = useState(SAMPLE_NOTES);
  const [mode, setMode] = useState<Mode>("summary");
  const [difficulty, setDifficulty] = useState<Difficulty>("Standard");
  const [flipped, setFlipped] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [showResults, setShowResults] = useState(false);
  const [aiKit, setAiKit] = useState<StudyKit | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>("idle");
  const [generationMessage, setGenerationMessage] = useState("");
  const [importedFile, setImportedFile] = useState<ImportedFile | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: "success" | "warning" | "error"; text: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const words = notes.trim() ? notes.trim().split(/\s+/).length : 0;
  const localSummary = useMemo(() => createSummary(source), [source]);
  const localTerms = useMemo(() => keyTerms(source), [source]);
  const localFlashcards = useMemo(() => createFlashcards(source), [source]);
  const localQuiz = useMemo(() => createQuiz(source), [source]);
  const limits = difficulty === "Quick" ? { summary: 2, cards: 3, quiz: 3 } : difficulty === "Deep" ? { summary: 4, cards: 6, quiz: 5 } : { summary: 3, cards: 4, quiz: 4 };
  const activeSummary = aiKit?.summary ?? localSummary.slice(0, limits.summary);
  const terms = aiKit?.keyTerms ?? localTerms;
  const activeFlashcards = aiKit?.flashcards ?? localFlashcards.slice(0, limits.cards);
  const activeQuiz = aiKit?.quiz ?? localQuiz.slice(0, limits.quiz);
  const activePlan: PlanStep[] = aiKit?.plan ?? [
    { time: "00–05", title: "Orient", description: "Read the summary once, then name the three ideas you expect to use most." },
    { time: "05–15", title: "Recall", description: `Work through ${activeFlashcards.length} flashcards without looking back at your notes.` },
    { time: "15–25", title: "Test", description: `Complete the ${activeQuiz.length}-question quiz and explain every missed answer aloud.` },
    { time: "25–30", title: "Lock it in", description: `Write one example for ${terms.slice(0, 2).join(" and ") || "the hardest concepts"}. Schedule a review tomorrow.` },
  ];
  const studyTip = aiKit?.studyTip ?? "Retrieval practice beats rereading. Try to answer first, then use your notes to correct the gaps.";
  const correct = activeQuiz.filter((question, index) => answers[index] === question.answer).length;
  const suggestedQuestions = ["Explain the hardest idea simply", "What should I memorize?", "Quiz me on this material", "Compare the main concepts"];

  async function generate() {
    if (!notes.trim()) return;
    const cleanNotes = notes.trim();
    setSource(cleanNotes); setAnswers({}); setShowResults(false); setFlipped(null); setAiKit(null);
    setGenerationStatus("loading"); setGenerationMessage("Building your study kit with AI…");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: cleanNotes, depth: difficulty }),
      });
      const data = await response.json() as { kit?: StudyKit; message?: string };
      if (!response.ok || !data.kit || !Array.isArray(data.kit.summary)) throw new Error(data.message || "AI generation failed.");
      setAiKit(data.kit);
      setGenerationStatus("ai");
      setGenerationMessage("Your study kit was generated with AI from these notes.");
    } catch (error) {
      setGenerationStatus("fallback");
      setGenerationMessage(error instanceof Error ? `${error.message} Showing a local study kit instead.` : "AI is unavailable. Showing a local study kit instead.");
    }
  }

  async function importFile(file: File) {
    setIsImporting(true);
    setImportMessage({ type: "success", text: `Reading ${file.name} in your browser…` });
    try {
      const extracted = await extractDocument(file);
      setNotes(extracted.text);
      setSource(extracted.text);
      setImportedFile({ name: file.name, size: file.size, pageCount: extracted.pageCount });
      setAiKit(null); setAnswers({}); setShowResults(false); setGenerationStatus("idle"); setGenerationMessage("");
      setChatMessages([]); setChatQuestion("");
      setImportMessage({
        type: extracted.warning ? "warning" : "success",
        text: extracted.warning || "Text extracted. Review or edit it below, then generate your study kit.",
      });
    } catch (error) {
      setImportedFile(null);
      setImportMessage({ type: "error", text: error instanceof Error ? error.message : "LearnCraft could not read that file." });
    } finally {
      setIsImporting(false);
    }
  }

  function importNotes(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void importFile(file);
    event.target.value = "";
  }

  function dropDocument(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !isImporting) void importFile(file);
  }

  function clearSource() {
    setNotes("");
    setImportedFile(null);
    setImportMessage(null);
    setAiKit(null);
    setGenerationStatus("idle");
    setGenerationMessage("");
    setChatMessages([]);
    setChatQuestion("");
  }

  async function askDocument(questionOverride?: string) {
    const question = (questionOverride ?? chatQuestion).trim();
    const studySource = notes.trim();
    if (!question || !studySource || chatLoading) return;
    const userMessage: ChatMessage = { id: `${Date.now()}-user`, role: "user", content: question };
    const previousMessages = chatMessages;
    setChatMessages([...previousMessages, userMessage]);
    setChatQuestion("");
    setChatLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: studySource,
          question,
          history: previousMessages.map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await response.json() as { answer?: string; message?: string };
      if (!response.ok || !data.answer) throw new Error(data.message || "AI chat is unavailable.");
      setChatMessages((messages) => [...messages, { id: `${Date.now()}-assistant`, role: "assistant", content: data.answer!, mode: "ai" }]);
    } catch {
      const answer = localDocumentAnswer(question, studySource);
      setChatMessages((messages) => [...messages, { id: `${Date.now()}-local`, role: "assistant", content: answer, mode: "local" }]);
    } finally {
      setChatLoading(false);
    }
  }

  function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void askDocument();
  }

  const tabs: { id: Mode; label: string; count?: number }[] = [
    { id: "summary", label: "Summary" }, { id: "flashcards", label: "Flashcards", count: activeFlashcards.length }, { id: "quiz", label: "Practice quiz", count: activeQuiz.length }, { id: "plan", label: "Study plan" }, { id: "chat", label: "Ask LearnCraft" },
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="LearnCraft home"><span className="brand-mark">L</span><span>LearnCraft</span></a>
        <nav className="nav-links" aria-label="Main navigation"><a className="active" href="#workspace">Workspace</a><a href="#how-it-works">How it works</a></nav>
        <div className="top-actions"><span className={`status-dot ${generationStatus}`}><i /> {generationStatus === "loading" ? "Creating study kit" : generationStatus === "ai" ? "Study kit ready" : generationStatus === "fallback" ? "Local fallback" : "Study mode"}</span></div>
      </header>

      <section className="workspace" id="workspace">
        <aside className="source-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">01 / SOURCE</span><h1>What are you studying?</h1></div>
            <span className="import-formats">PDF · DOCX · TXT · MD</span>
          </div>
          <div
            className={`drop-zone ${isDragging ? "dragging" : ""} ${isImporting ? "importing" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false); }}
            onDrop={dropDocument}
          >
            <span className="drop-icon">↥</span>
            <div><strong>{isImporting ? "Reading your document…" : isDragging ? "Drop it here" : "Add course material"}</strong><p>Drop a PDF, Word document, text, or Markdown file here. <label htmlFor="source-file">Browse files</label></p></div>
            <input id="source-file" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" onChange={importNotes} disabled={isImporting} />
          </div>
          {importedFile && <div className="file-chip"><span>✓</span><div><strong>{importedFile.name}</strong><small>{formatFileSize(importedFile.size)}{importedFile.pageCount ? ` · ${importedFile.pageCount} pages` : ""}</small></div><button type="button" onClick={clearSource} aria-label={`Remove ${importedFile.name}`}>×</button></div>}
          {importMessage && <div className={`import-notice ${importMessage.type}`} role="status"><span>{importMessage.type === "error" ? "!" : importMessage.type === "warning" ? "i" : "✓"}</span><p>{importMessage.text}</p></div>}
          <div className="input-wrap">
            <textarea value={notes} maxLength={MAX_STUDY_CHARS} onChange={(event) => setNotes(event.target.value)} placeholder="Paste lecture notes, a textbook section, or your own study guide…" aria-label="Extracted study text" />
            <div className="input-meta"><span>{words.toLocaleString()} words · {notes.length.toLocaleString()}/{MAX_STUDY_CHARS.toLocaleString()} characters</span><button onClick={clearSource} disabled={!notes}>Clear</button></div>
          </div>
          <div className="controls-row">
            <div><label htmlFor="depth">Study depth</label><select id="depth" value={difficulty} disabled={generationStatus === "loading"} onChange={(event) => { setDifficulty(event.target.value as Difficulty); setAnswers({}); setShowResults(false); setAiKit(null); setGenerationStatus("idle"); setGenerationMessage(""); }}><option>Quick</option><option>Standard</option><option>Deep</option></select></div>
            <button className="generate-button" onClick={generate} disabled={!notes.trim() || generationStatus === "loading"}><span>{generationStatus === "loading" ? "Creating your kit…" : "Generate with AI"}</span><b>{generationStatus === "loading" ? "✦" : "→"}</b></button>
          </div>
          {generationMessage && <div className={`generation-notice ${generationStatus}`} role="status"><span>{generationStatus === "ai" ? "✦" : generationStatus === "loading" ? "◌" : "i"}</span><p>{generationMessage}</p></div>}
          <div className="privacy-note"><span>◉</span><p><strong>Your original file stays in your browser.</strong><br />LearnCraft extracts its text locally. Only that text is sent through the secure AI route when you generate a kit.</p></div>
        </aside>

        <section className="results-panel" aria-live="polite">
          <div className="results-heading"><div><span className="eyebrow">02 / STUDY KIT</span><h2>{generationStatus === "loading" ? "Turning notes into understanding…" : generationStatus === "ai" ? "Your AI study kit is ready." : "Ready when you are."}</h2></div><span className="depth-badge">{difficulty} depth</span></div>
          <div className="tabs" role="tablist" aria-label="Study tools">
            {tabs.map((tab) => <button key={tab.id} className={mode === tab.id ? "selected" : ""} onClick={() => setMode(tab.id)} role="tab" aria-selected={mode === tab.id}>{tab.label}{tab.count ? <span>{tab.count}</span> : null}</button>)}
          </div>

          <div className="result-content">
            {mode === "summary" && <div className="summary-view">
              <div className="result-title-row"><div><span className="section-kicker">THE BIG PICTURE</span><h3>Core ideas from your notes</h3></div><button onClick={() => navigator.clipboard?.writeText(activeSummary.join("\n\n"))}>Copy summary</button></div>
              <ol className="summary-list">{activeSummary.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol>
              <div className="concepts-card"><span className="section-kicker">KEY CONCEPTS</span><div className="term-list">{terms.map((term) => <span key={term}>{term}</span>)}</div></div>
            </div>}

            {mode === "flashcards" && <div className="flashcard-view">
              <div className="result-title-row"><div><span className="section-kicker">ACTIVE RECALL</span><h3>Tap a card to reveal the answer</h3></div><span className="progress-label">{activeFlashcards.length} cards</span></div>
              <div className="card-grid">{activeFlashcards.map((card, index) => <button key={`${card.front}-${index}`} className={`flashcard ${flipped === index ? "flipped" : ""}`} onClick={() => setFlipped(flipped === index ? null : index)} aria-label={`Flashcard ${index + 1}. ${flipped === index ? card.back : card.front}`}><span>{flipped === index ? "ANSWER" : `CARD ${String(index + 1).padStart(2, "0")}`}</span><strong>{flipped === index ? card.back : card.front}</strong><small>{flipped === index ? "Tap to hide" : "Tap to reveal →"}</small></button>)}</div>
            </div>}

            {mode === "quiz" && <div className="quiz-view">
              <div className="result-title-row"><div><span className="section-kicker">CHECK YOUR UNDERSTANDING</span><h3>{showResults ? `You scored ${correct}/${activeQuiz.length}` : "Choose the best answer"}</h3></div>{showResults && <span className="score-ring">{Math.round((correct / activeQuiz.length) * 100)}%</span>}</div>
              <div className="question-list">{activeQuiz.map((question, questionIndex) => <article className="question-card" key={question.prompt}><p><span>{questionIndex + 1}</span>{question.prompt}</p><div className="option-grid">{question.options.map((option, optionIndex) => {
                const chosen = answers[questionIndex] === optionIndex; const correctOption = showResults && question.answer === optionIndex; const wrongOption = showResults && chosen && question.answer !== optionIndex;
                return <button key={option} className={`${chosen ? "chosen" : ""} ${correctOption ? "correct" : ""} ${wrongOption ? "wrong" : ""}`} onClick={() => !showResults && setAnswers({ ...answers, [questionIndex]: optionIndex })}><i>{String.fromCharCode(65 + optionIndex)}</i>{option}</button>;
              })}</div>{showResults && <small className="explanation">{question.explanation}</small>}</article>)}</div>
              <button className="quiz-submit" onClick={() => showResults ? (setAnswers({}), setShowResults(false)) : setShowResults(true)} disabled={!showResults && Object.keys(answers).length !== activeQuiz.length}>{showResults ? "Try again" : `Check ${Object.keys(answers).length}/${activeQuiz.length} answers`}</button>
            </div>}

            {mode === "plan" && <div className="plan-view">
              <div className="result-title-row"><div><span className="section-kicker">30-MINUTE FOCUS PLAN</span><h3>Study in small, deliberate rounds</h3></div><span className="progress-label">4 steps</span></div>
              <div className="timeline">{activePlan.map((step, index) => <article key={`${step.time}-${step.title}`}><div className="time-node"><span>{step.time}</span><i>{index + 1}</i></div><div><h4>{step.title}</h4><p>{step.description}</p></div></article>)}</div>
              <div className="tip-card"><span>STUDY TIP</span><p>{studyTip}</p></div>
            </div>}

            {mode === "chat" && <div className="chat-view">
              <div className="result-title-row"><div><span className="section-kicker">GROUNDED DOCUMENT CHAT</span><h3>Ask your material anything</h3></div><span className="source-badge"><i /> Source only</span></div>
              {chatMessages.length === 0 && <div className="chat-welcome"><span>✦</span><div><h4>Start with a question</h4><p>LearnCraft answers from the material on the left—not from the open web. If the answer is not in your notes, it will say so.</p></div></div>}
              <div className="suggestion-list" aria-label="Suggested questions">
                {suggestedQuestions.map((question) => <button key={question} type="button" onClick={() => void askDocument(question)} disabled={!notes.trim() || chatLoading}>{question}<span>→</span></button>)}
              </div>
              {chatMessages.length > 0 && <div className="chat-thread" aria-live="polite">
                {chatMessages.map((message) => <article key={message.id} className={`chat-message ${message.role}`}><div className="chat-avatar">{message.role === "assistant" ? "L" : "You"}</div><div><span>{message.role === "assistant" ? "LearnCraft" : "You"}{message.mode ? <small>{message.mode === "ai" ? "AI answer" : "Local grounded answer"}</small> : null}</span><p>{message.content}</p></div></article>)}
                {chatLoading && <article className="chat-message assistant loading"><div className="chat-avatar">L</div><div><span>LearnCraft</span><p>Searching your material<span className="typing-dots">…</span></p></div></article>}
              </div>}
              <form className="chat-composer" onSubmit={submitChat}>
                <label htmlFor="chat-question">Question about your material</label>
                <div><input id="chat-question" value={chatQuestion} maxLength={600} onChange={(event) => setChatQuestion(event.target.value)} placeholder={notes.trim() ? "Ask for an explanation, comparison, example…" : "Add source material first…"} disabled={!notes.trim() || chatLoading} /><button type="submit" disabled={!chatQuestion.trim() || !notes.trim() || chatLoading} aria-label="Send question">{chatLoading ? "◌" : "↑"}</button></div>
                <small>{chatQuestion.length}/600 · Answers stay grounded in your source</small>
              </form>
            </div>}
          </div>
        </section>
      </section>

      <section className="how-section" id="how-it-works"><span className="eyebrow">BUILT FOR REAL STUDY SESSIONS</span><h2>Less organizing. More remembering.</h2><div className="how-grid"><article><b>01</b><h3>Bring your material</h3><p>Drop in a PDF, Word document, text file, or your own notes. Review the extracted text before AI uses it.</p></article><article><b>02</b><h3>Ask and understand</h3><p>Chat with your material for simple explanations, comparisons, and grounded answers.</p></article><article><b>03</b><h3>Practice actively</h3><p>Turn dense material into summaries, flashcards, quizzes, and a focused study plan.</p></article></div></section>
      <footer><span>LearnCraft</span><p>Made for students who want to understand—not just reread.</p><small>built by me</small></footer>
    </main>
  );
}
