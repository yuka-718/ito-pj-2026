import type { Metadata, Viewport } from "next";
import "./globals.css";

const publicUrl = "https://yuka-718.github.io/ito-pj-2026/";

export const metadata: Metadata = {
  metadataBase: new URL(publicUrl),
  title: "ORI AI — 折り紙生成プロトタイプ",
  description:
    "プロンプトと参考画像から、折り紙の展開図と完成形3Dモデルを表示する研究プロトタイプ。",
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
    siteName: "ORI AI",
    title: "ORI AI — 展開図と完成形3Dを生成",
    description: "プロンプトと参考画像を入力して、折り紙の展開図と完成形3Dモデルを表示します。",
    images: [{ url: "og-studio.png", width: 1731, height: 909, alt: "ORI AI 折り紙生成プロトタイプ" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ORI AI — 展開図と完成形3Dを生成",
    description: "プロンプトと参考画像を入力して、折り紙の展開図と完成形3Dモデルを表示します。",
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
