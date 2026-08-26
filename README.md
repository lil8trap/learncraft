# LearnCraft

LearnCraft turns notes and study documents into focused summaries, flashcards,
practice quizzes, study plans, and source-grounded chat.

## Features

- PDF, DOCX, TXT, Markdown, and pasted-text import
- AI-generated study kits at three depth levels
- Source-grounded document chat
- Local document text extraction for privacy
- Responsive interface with keyboard-friendly controls
- Server-side API key handling and public-demo request protection

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Add `OPENAI_API_KEY` to `.env.local`.
4. Run `npm run dev`.

The OpenAI key is used only by server-side API routes and must never be exposed
through a `NEXT_PUBLIC_` variable.

## Deploy to Vercel

Set these environment variables in the Vercel project:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (defaults to `gpt-5.4-mini`)

Then deploy the project as a Next.js application.
