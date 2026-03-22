import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quant IQ — Macro Intelligence for Investors",
  description: "Real-time macro and geopolitical intelligence, AI-classified events, investment themes, and portfolio advisory for independent US market investors.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
