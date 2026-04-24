import Link from "next/link";
import { signOut } from "@/auth";

type UserLike = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export function UserMenu({ user }: { user: UserLike | null }) {
  if (!user) {
    return (
      <Link
        href="/sign-in"
        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-text transition-colors hover:border-white/20"
      >
        Sign in
      </Link>
    );
  }

  const label = user.name ?? user.email ?? "Account";
  const initials =
    (user.name ?? user.email ?? "?")
      .split(/\s+|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0]?.toUpperCase() ?? "")
      .join("") || "·";

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1">
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image}
          alt=""
          className="h-7 w-7 rounded-full"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span
          className="grid h-7 w-7 place-items-center rounded-full font-mono text-[10px] font-bold text-white"
          style={{
            background: "linear-gradient(135deg, #2DD4BF 0%, #EC4899 100%)",
          }}
        >
          {initials}
        </span>
      )}
      <div className="hidden pr-1 font-mono text-[10px] leading-tight sm:block">
        <div className="max-w-[10rem] truncate font-semibold text-text">
          {label}
        </div>
        <div className="text-muted">{user.email ?? "Signed in"}</div>
      </div>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/sign-in" });
        }}
      >
        <button
          type="submit"
          className="ml-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted transition-colors hover:border-white/20 hover:text-text"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
