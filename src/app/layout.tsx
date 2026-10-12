import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VRYSE — AI blog writing",
  description: "Company-style article generation with evaluation and a human feedback loop",
};

const NAV = [
  { href: "/", label: "Runs" },
  { href: "/articles/new", label: "New article" },
  { href: "/company/routematic", label: "Style profile" },
  { href: "/memory", label: "Memory" },
  { href: "/observability", label: "Usage" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <header className="border-b">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              VRYSE
            </Link>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-sm text-muted-foreground hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
