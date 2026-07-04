// AdminLogin — the backstage login form (PATTERN-SPEC §A6 login UX, plan §5.3).
// Self-contained view. The password is hashed in the browser (adminAuth) and
// string-compared server-side against admin_users.password_hash; on success the
// backend returns a signed session token we persist (cookie + localStorage).
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import { adminService } from '@/core/services/admin';
import { adminAuth, hashPassword } from '@/core/services/adminAuth';

function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Client-side "already signed in" redirect. Replaces the old SSR cookie guard
  // (removed because the Shopify proxy strips cookies — plan §4): if a session
  // token is already in localStorage, skip the form and go to the dashboard.
  useEffect(() => {
    if (adminAuth.getToken()) router.replace('/admin');
  }, [router]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    setBusy(true);
    try {
      const passwordHash = hashPassword(email, password);
      const { data, ok } = await adminService.login(email, passwordHash);
      if (!ok) {
        setError(data?.error || 'Login failed. Please try again.');
        return;
      }
      adminAuth.setSession({
        token: data.data.token,
        email: data.data.email,
      });
      router.push('/admin');
    } catch (err) {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container py-5" style={{ maxWidth: 420 }}>
      <h1 className="tw-text-custom-green mb-4" style={{ fontFamily: 'Sora, sans-serif' }}>
        Admin sign in
      </h1>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} noValidate>
        <div className="mb-3">
          <label className="form-label" htmlFor="admin-email">
            Email
          </label>
          <input
            id="admin-email"
            type="email"
            className="form-control"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="mb-4">
          <label className="form-label" htmlFor="admin-password">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            className="form-control"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button type="submit" className="btn btn-success w-100" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

export default AdminLogin;
