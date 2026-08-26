import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://learncraftstudy.com"),
  title: "LearnCraft — Turn notes into understanding",
  description: "Transform class notes into clear summaries, active-recall flashcards, practice quizzes, and focused study plans.",
  openGraph: { title: "LearnCraft", description: "Turn notes into understanding.", type: "website", images: ["/og.png"] },
  twitter: { card: "summary_large_image", title: "LearnCraft", description: "Turn notes into understanding.", images: ["/og.png"] },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
