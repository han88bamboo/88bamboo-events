// pages/_app.js — root wrapper (PATTERN-SPEC §B3.1/§B4.3.3).
// Global CSS import order matters: Bootstrap -> globals -> toastify.
import { useEffect } from 'react';

import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '@/styles/globals.css';
import 'react-toastify/dist/ReactToastify.css';

export default function App({ Component, pageProps }) {
  useEffect(() => {
    // Bootstrap's JS bundle (modals/dropdowns) is browser-only.
    import('bootstrap/dist/js/bootstrap.bundle.min.js');
  }, []);

  return <Component {...pageProps} />;
}
