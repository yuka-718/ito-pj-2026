import type { Metadata, Viewport } from "next";
import "./globals.css";

const publicUrl = "https://yuka-718.github.io/ito-pj-2026/";

export const metadata: Metadata = {
  metadataBase: new URL(publicUrl),
  title: "ORI AI Studio — 言葉から折り紙の構造候補へ",
  description:
    "つくりたい形の特徴を整理し、単頂点の折り紙構造候補を生成・局所検証・書き出しできる、未踏ジュニア2026 伊藤PJのブラウザ版研究プロトタイプ。",
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
    siteName: "ORI AI Studio",
    title: "ORI AI Studio — 言葉から、折りの候補へ。",
    description: "特徴を編集し、構造候補を生成・局所検証・SVG／FOLD書き出しできるブラウザ版研究プロトタイプ。",
    images: [{ url: "og-studio.png", width: 1731, height: 909, alt: "ORI AI Studio — 言葉から、折りの候補へ。" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ORI AI Studio — 言葉から、折りの候補へ。",
    description: "特徴を編集し、構造候補を生成・局所検証・SVG／FOLD書き出しできるブラウザ版研究プロトタイプ。",
    images: ["og-studio.png"],
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
