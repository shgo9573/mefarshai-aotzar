import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Frank_Ruhl_Libre, Heebo, Noto_Serif_Hebrew } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-ui",
});

const frank = Frank_Ruhl_Libre({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-frank",
});

const noto = Noto_Serif_Hebrew({
  subsets: ["hebrew"],
  weight: ["400", "600", "700"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "בועות הדף",
  description: "צורת הדף של הש״ס עם בועות על הגמרא ומפרשים בלחיצה.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${frank.variable} ${noto.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
