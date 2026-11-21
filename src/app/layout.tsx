import type { Metadata, Viewport } from 'next';
import { Readex_Pro } from 'next/font/google';
import './globals.css';

const readexPro = Readex_Pro({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-readex-pro',
  display: 'swap',
});

const ANTI_FOUC_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('mohasba-theme');if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export const metadata: Metadata = {
  title: 'جدول المحاسبة',
  description: 'محاسبة يومية سريعة ومتابعة أسبوعية منضبطة تعمل بدون إنترنت.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#0F5257',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={readexPro.variable}
      suppressHydrationWarning
    >
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <script
          dangerouslySetInnerHTML={{ __html: ANTI_FOUC_THEME_SCRIPT }}
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
