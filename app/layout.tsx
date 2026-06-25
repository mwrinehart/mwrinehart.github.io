import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jericho Security Platform",
  description: "Unified human-risk, compliance, content, and campaign-simulation platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
