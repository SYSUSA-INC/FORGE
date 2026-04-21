import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { error?: string; callbackUrl?: string };
}) {
  const session = await auth();
  if (session?.user) {
    redirect(searchParams.callbackUrl ?? "/");
  }

  const error = searchParams.error;

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-4 py-12">
      <div className="aur-card-elevated w-full max-w-md overflow-hidden">
        <div
          className="h-[2px] w-full"
          style={{
            background: "linear-gradient(90deg, #2DD4BF, #34D399 55%, #EC4899)",
          }}
        />
        <div className="px-8 py-10">
          <div className="flex items-center gap-3">
            <div
              className="grid h-9 w-9 place-items-center rounded-lg font-display text-sm font-bold text-white shadow-glow"
              style={{
                background:
                  "linear-gradient(135deg, #2DD4BF, #34D399 55%, #EC4899 100%)",
              }}
            >
              F
            </div>
            <div>
              <div className="font-display text-[15px] font-semibold tracking-tight text-text">
                FORGE
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
                Proposal Ops
              </div>
            </div>
          </div>

          <h1 className="mt-8 font-display text-2xl font-semibold tracking-tight text-text">
            Sign in to your workspace
          </h1>
          <p className="mt-2 text-sm text-muted">
            Use your GitHub account to continue.
          </p>

          {error ? (
            <div className="mt-6 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {errorMessage(error)}
            </div>
          ) : null}

          <form
            className="mt-6"
            action={async () => {
              "use server";
              await signIn("github", {
                redirectTo: searchParams.callbackUrl ?? "/",
              });
            }}
          >
            <button
              type="submit"
              className="aur-btn aur-btn-primary flex w-full items-center justify-center gap-3 py-3 text-sm"
            >
              <GithubIcon />
              <span>Continue with GitHub</span>
            </button>
          </form>

          <p className="mt-6 text-center text-[11px] text-subtle">
            By signing in you agree to the FORGE terms of service.
          </p>
        </div>
      </div>
    </div>
  );
}

function errorMessage(error: string): string {
  switch (error) {
    case "AccessDenied":
      return "Access denied. Your account is not authorized.";
    case "Verification":
      return "Sign-in link expired or already used. Try again.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount":
      return "Error communicating with GitHub. Please try again.";
    case "Configuration":
      return "Authentication is not configured correctly. Contact an administrator.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

function GithubIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.38 7.86 10.9.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.19 1.18.93-.26 1.92-.39 2.9-.39s1.98.13 2.9.39c2.22-1.49 3.19-1.18 3.19-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56C20.21 21.38 23.5 17.08 23.5 12 23.5 5.73 18.27.5 12 .5z" />
    </svg>
  );
}
