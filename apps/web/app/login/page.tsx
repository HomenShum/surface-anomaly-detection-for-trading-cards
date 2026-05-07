import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="container page-stack narrow">
      <div className="page-kicker">Account</div>
      <h1 className="page-title">Sign in</h1>
      <p className="lede">
        Google OAuth is configured through `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
        `NEXTAUTH_URL`, and `NEXTAUTH_SECRET`. Sample mode stays available without OAuth.
      </p>
      <div className="actions">
        <Link className="button" href="/api/auth/signin">
          Continue with Google
        </Link>
        <Link className="button secondary" href="/demo">
          Continue in sample mode
        </Link>
      </div>
    </main>
  );
}
