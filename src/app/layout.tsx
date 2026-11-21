import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'جدول المحاسبة — Mohasba Tracker',
  description: 'Personal offline-first worship and daily accountability ledger.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
