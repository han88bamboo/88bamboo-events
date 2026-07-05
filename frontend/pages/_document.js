// pages/_document.js — custom HTML document (PATTERN-SPEC §B3.1/§B4.3.2).
// Loads Buenard (the 88bamboo.co storefront heading font — serif, weights 400/700)
// so the Events app matches the main site (STYLE-PARITY-PLAN §5). Body copy uses a
// generic serif system stack (no web font needed). display=swap keeps SSR text
// visible immediately with the serif fallback — no layout shift on Buenard load.
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Buenard:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
