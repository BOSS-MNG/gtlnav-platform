import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getRequestSession, logServerEvent } from "@/src/lib/server-supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Disconnect the user's GitHub account. We:
 *  - Delete the row in `github_accounts`.
 *  - Optionally null-out cached repository rows (we only delete repos owned
 *    by *this* GTLNAV user — RLS already enforces that, but we're explicit).
 *  - Append an audit entry.
 *
 * Tokens are removed from rest storage. We do NOT call GitHub's revoke
 * endpoint here — that needs a separate authenticated outbound call and is
 * left as a follow-up task once the encryption envelope is rotated.
 */
export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { client, userId } = session;

  // Fetch the existing account so we can include the login in the audit log.
  const accountResp = await client
    .from("github_accounts")
    .select("github_login")
    .eq("user_id", userId)
    .maybeSingle();

  if (accountResp.error) {
    return NextResponse.json(
      { error: "github_accounts_query_failed", message: accountResp.error.message },
      { status: 500 },
    );
  }

  const login = accountResp.data?.github_login ?? null;

  const reposResp = await client
    .from("github_repositories")
    .delete()
    .eq("user_id", userId);
  if (reposResp.error && !isMissingTable(reposResp.error.message)) {
    return NextResponse.json(
      { error: "github_repositories_delete_failed", message: reposResp.error.message },
      { status: 500 },
    );
  }

  const accountDelete = await client
    .from("github_accounts")
    .delete()
    .eq("user_id", userId);
  if (accountDelete.error && !isMissingTable(accountDelete.error.message)) {
    return NextResponse.json(
      { error: "github_account_delete_failed", message: accountDelete.error.message },
      { status: 500 },
    );
  }

  await logServerEvent(client, {
    userId,
    event: "github_oauth_disconnected",
    message: login
      ? `Disconnected GitHub account @${login}.`
      : "Disconnected GitHub integration.",
    metadata: { github_login: login },
  });

  return NextResponse.json({ ok: true, github_login: login });
}

function isMissingTable(message: string | undefined | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("could not find the table") ||
    lower.includes("schema cache")
  );
}
