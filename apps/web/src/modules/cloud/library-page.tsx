import { useState } from "react";
import { useAuth } from "@workos-inc/authkit-react";
import { Link } from "@tanstack/react-router";
import { Button, buttonVariants } from "@raee/ui/components/button";
import { OptionSelect } from "@raee/ui/components/option-select";
import { AppPage } from "@/modules/shell/app-shell";
import { useActiveTeam } from "./active-team";
import { currentReturnTo, useCloud } from "./cloud-provider";
import { CloudLibrary } from "./library-panel";

export function LibraryPage() {
  const { configured } = useCloud();
  return (
    <AppPage title="Library" description="Your team's cloud files. Open any of them in the editor.">
      {configured ? (
        <TeamLibrary />
      ) : (
        <p>Cloud is not configured for this app. Studio takes stay on this device.</p>
      )}
      <p className="text-sm text-muted-foreground">
        Takes saved to this device are in the editor, under Project media.{" "}
        <Link to="/" className="underline underline-offset-4">
          Open the editor
        </Link>
      </p>
    </AppPage>
  );
}

function TeamLibrary() {
  const { isLoading, isAuthenticated, teams, current, select } = useActiveTeam();
  if (isLoading || (isAuthenticated && !teams)) return <p role="status">Loading your library…</p>;
  if (!isAuthenticated || !current)
    return (
      <div className="grid justify-items-start gap-3">
        <p>
          {isAuthenticated
            ? "Create or join a team to get a cloud library."
            : "Sign in to see your team's library."}
        </p>
        {isAuthenticated ? (
          <Link to="/team" className={buttonVariants({ size: "sm" })}>
            Go to Team
          </Link>
        ) : (
          <SignInButton />
        )}
      </div>
    );
  return (
    <div className="grid gap-4">
      {teams && teams.length > 1 && (
        <label className="grid max-w-sm gap-1">
          Team
          <OptionSelect
            value={current.team._id}
            options={teams.map((entry) => ({ value: entry.team._id, label: entry.team.name }))}
            onValueChange={select}
          />
        </label>
      )}
      <CloudLibrary
        key={current.team._id}
        teamId={current.team._id}
        readOnly={current.role === "viewer"}
      />
    </div>
  );
}

function SignInButton() {
  const { signIn } = useAuth();
  const [error, setError] = useState("");
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <Button
        size="sm"
        onClick={() => {
          void signIn({ state: { returnTo: currentReturnTo() } }).catch(() =>
            setError("Sign-in could not start. Try again."),
          );
        }}
      >
        Sign in
      </Button>
    </>
  );
}
