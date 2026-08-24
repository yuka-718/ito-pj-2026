import type { Metadata, Viewport } from "next";
import "./globals.css";

const publicUrl = "https://yuka-718.github.io/ito-pj-2026/";

export const metadata: Metadata = {
  metadataBase: new URL(publicUrl),
  title: "ORI / AI — LLMを用いた折り紙展開図作成ソフト",
  description:
    "未踏ジュニア2026 伊藤夕夏プロジェクト。LLMと折り紙ソフトをつなぎ、創作折り紙の展開図候補を生成・検証する研究開発の記録。",
  authors: [{ name: "伊藤夕夏" }],
  alternates: { canonical: publicUrl },
  icons: {
    icon: "favicon.svg",
    shortcut: "favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: publicUrl,
    siteName: "ORI / AI",
    title: "ORI / AI — 折り紙の「構造」を、AIと探る。",
    description: "LLMと計算折り紙ソフトをつなぐ、未踏ジュニア2026の研究プロトタイプ。",
    images: [{ url: "og.png", width: 1734, height: 907, alt: "ORI / AI — 折り紙の「構造」を、AIと探る。" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ORI / AI — 折り紙の「構造」を、AIと探る。",
    description: "LLMと計算折り紙ソフトをつなぐ、未踏ジュニア2026の研究プロトタイプ。",
    images: ["og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#17243f",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
