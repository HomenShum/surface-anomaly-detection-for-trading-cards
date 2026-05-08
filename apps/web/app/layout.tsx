import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Card Condition Vault",
  description: "Mobile-first card condition scanner and collection vault."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const navItems = [
  ["Dashboard", "/dashboard"],
  ["Workspace", "/workspace"],
  ["Examples", "/examples"],
  ["Cert import", "/certs/import"],
  ["Benchmarks", "/benchmarks"],
  ["Scan", "/scan"],
  ["Cards", "/cards"],
  ["Methods", "/methods"],
  ["Compare", "/compare"]
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>
          <div className="app-shell">
            <header className="topbar">
              <Link className="brand" href="/">
                <span className="brand-mark">CV</span>
                <span>Card Condition Vault</span>
              </Link>
              <nav className="nav" aria-label="Primary">
                {navItems.map(([label, href]) => (
                  <Link key={href} href={href}>
                    {label}
                  </Link>
                ))}
              </nav>
            </header>
            {children}
          </div>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
