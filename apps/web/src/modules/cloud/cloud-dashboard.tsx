import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { RiArrowLeftLine, RiArrowRightUpLine, RiFolderVideoLine } from "@remixicon/react";
import { AppShell } from "@/modules/shell/app-shell";
import { browserCloudConfig } from "./config";
import { cloudSections, type Section } from "./cloud-sections";
import "./cloud-dashboard.css";

const descriptions: Record<Section, string> = {
  overview: "Your team, shared media and cloud workflows, together.",
  library: "Find and organize the media shared with your team.",
  team: "Manage your account, teammates and invitations.",
  reviews: "Keep feedback connected to the right version.",
  publishing: "Prepare content and manage its destinations.",
  usage: "Understand your plan, storage and processing usage.",
};

const upcoming = {
  reviews: [
    ["Versioned playback", "Hosted video playback and thumbnails are not available yet."],
    [
      "Share links and guest feedback",
      "Guest review pages and sharing controls are not available yet.",
    ],
  ],
  publishing: [
    ["AI-assisted edits", "Cloud processing, transcripts and derived edits are not available yet."],
    ["Connected accounts", "Provider sign-in and account management are not available yet."],
    ["Scheduled publishing", "Publishing and scheduling controls are not available yet."],
  ],
  usage: [
    ["Plan and billing", "Checkout and subscription management are not available yet."],
    ["Storage and processing", "Usage totals and storage billing are not available yet."],
    ["Account data", "Account export and deletion controls are not available yet."],
  ],
} satisfies Record<"reviews" | "publishing" | "usage", string[][]>;

export type UpcomingSection = keyof typeof upcoming;

function useConfigured() {
  const [configured] = useState(() => browserCloudConfig() !== null);
  return configured;
}

function sectionLabel(section: Section) {
  return cloudSections.find((item) => item.id === section)?.label ?? "Overview";
}

/** Cloud pages share the app rail with Studio, Library, Edit and Team. */
export function CloudLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="app-page cloud-dashboard">
        <main id="cloud-main" className="cloud-main">
          {children}
        </main>
      </div>
    </AppShell>
  );
}

function PageHeading({ section }: { section: Section }) {
  return (
    <div className="cloud-page-heading">
      <h1>{sectionLabel(section)}</h1>
      <p>{descriptions[section]}</p>
    </div>
  );
}

export function CloudOverviewPage() {
  const configured = useConfigured();
  return (
    <>
      <PageHeading section="overview" />
      <section className="cloud-start" aria-labelledby="cloud-start-title">
        <div>
          <RiFolderVideoLine aria-hidden="true" size={32} />
          <h2 id="cloud-start-title">Make room for your next project.</h2>
          <p>
            Organize shared media, choose your team and bring collaborators into the same workspace.
          </p>
          <Link to="/library" className="cloud-primary-link">
            Open library <RiArrowRightUpLine size={18} aria-hidden="true" />
          </Link>
        </div>
        <div className="cloud-start-note">
          <h3>{configured ? "Connect your team" : "Cloud access is not set up"}</h3>
          <p>
            {configured
              ? "Open Team to sign in, choose a workspace or accept an invitation."
              : "Team and library access will be available when cloud services are configured for this app."}
          </p>
          <Link to="/team">
            Account and team <RiArrowRightUpLine size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>
      <section className="cloud-workflows" aria-labelledby="cloud-workflows-title">
        <h2 id="cloud-workflows-title">Cloud workflows</h2>
        <div className="cloud-workflow-list">
          {cloudSections
            .filter((item) => item.id !== "overview")
            .map(({ id, to, label, icon: Icon }) => (
              <Link key={id} to={to} className="cloud-workflow-row">
                <Icon size={21} aria-hidden="true" />
                <div>
                  <h3>{label}</h3>
                  <p>{descriptions[id]}</p>
                </div>
                <span className="cloud-status">
                  {id === "team" || id === "library"
                    ? configured
                      ? "Available"
                      : "Setup required"
                    : "Coming soon"}
                </span>
                <RiArrowRightUpLine size={18} aria-hidden="true" />
              </Link>
            ))}
        </div>
      </section>
    </>
  );
}

export function CloudUpcomingPage({ section }: { section: UpcomingSection }) {
  const title = sectionLabel(section);
  return (
    <>
      <PageHeading section={section} />
      <section className="cloud-upcoming" aria-label={`${title} availability`}>
        <span className="cloud-status">Coming soon</span>
        <h2>{title} tools are not available yet</h2>
        <p>This area will bring these tools into your cloud workspace.</p>
        <dl>
          {upcoming[section].map(([label, description]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
        <Link to="/" className="cloud-editor-link">
          <RiArrowLeftLine size={16} aria-hidden="true" /> Continue editing
        </Link>
      </section>
    </>
  );
}
