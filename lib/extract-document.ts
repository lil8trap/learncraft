const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
export const MAX_STUDY_CHARS = 20_000;

export type ExtractedDocument = {
  text: string;
  pageCount?: number;
  warning?: string;
};

function extensionOf(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function cleanText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function limitText(text: string) {
  if (text.length <= MAX_STUDY_CHARS) return { text };
  return {
    text: text.slice(0, MAX_STUDY_CHARS).trimEnd(),
    warning: `Only the first ${MAX_STUDY_CHARS.toLocaleString()} characters were imported so LearnCraft can build a focused study kit.`,
  };
}

async function extractPdf(file: File): Promise<ExtractedDocument> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pagesToRead = Math.min(pageCount, MAX_PDF_PAGES);
  const pageTexts: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pageTexts.push(`Page ${pageNumber}\n${text}`);
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  const extracted = cleanText(pageTexts.join("\n\n"));
  if (extracted.length < 80) {
    throw new Error("This PDF appears to contain scanned images instead of selectable text. OCR support is coming next; for now, use a text-based PDF or paste the text.");
  }

  const limited = limitText(extracted);
  const pageWarning = pageCount > MAX_PDF_PAGES
    ? `This PDF has ${pageCount} pages, so LearnCraft read the first ${MAX_PDF_PAGES}.`
    : undefined;

  return {
    text: limited.text,
    pageCount,
    warning: [pageWarning, limited.warning].filter(Boolean).join(" ") || undefined,
  };
}

async function extractDocx(file: File): Promise<ExtractedDocument> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const extracted = cleanText(result.value);
  if (!extracted) throw new Error("No readable text was found in this Word document.");
  const limited = limitText(extracted);
  const conversionWarning = result.messages.length
    ? "Some complex Word formatting was simplified during import."
    : undefined;
  return {
    text: limited.text,
    warning: [conversionWarning, limited.warning].filter(Boolean).join(" ") || undefined,
  };
}

export async function extractDocument(file: File): Promise<ExtractedDocument> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("That file is larger than 10 MB. Choose a smaller document or paste the section you want to study.");
  }

  const extension = extensionOf(file);
  if (extension === "pdf" || file.type === "application/pdf") return extractPdf(file);
  if (extension === "docx" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return extractDocx(file);
  if (["txt", "md", "markdown"].includes(extension) || file.type.startsWith("text/")) {
    const extracted = cleanText(await file.text());
    if (!extracted) throw new Error("This file does not contain any readable text.");
    return limitText(extracted);
  }

  throw new Error("LearnCraft currently supports PDF, DOCX, TXT, and Markdown files.");
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
