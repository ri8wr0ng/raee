import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { MediaBin } from "./media-bin";
import { CommentsPanel } from "./comments-panel";
import { HistoryPanel } from "./history-panel";
import { assistantBridge } from "./assistant-bridge";
import { SIDE_TABS, type SideTab } from "./panel-sizes";

const AssistantPanel = lazy(() =>
  import("./assistant-panel").then((module) => ({ default: module.AssistantPanel })),
);

const TAB_LABEL: Record<SideTab, string> = {
  media: "Media",
  comments: "Comments",
  history: "History",
  assistant: "Assistant",
};

export function SidePanel({
  tab,
  onTab,
  run,
  hideButton,
}: {
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  run: (action: () => unknown) => void;
  hideButton: ReactNode;
}) {
  // Check the desktop bridge after mount so hydration matches the prerendered browser markup.
  const [hasAssistant, setHasAssistant] = useState(false);
  useEffect(() => setHasAssistant(Boolean(assistantBridge())), []);
  const visibleTabs = SIDE_TABS.filter((id) => id !== "assistant" || hasAssistant);

  return (
    <Tabs
      id="side-panel"
      className="editor-side-panel"
      value={visibleTabs.includes(tab) ? tab : "media"}
      onValueChange={(next) => next && onTab(next)}
    >
      <TabsList className="editor-side-tabs" aria-label="Side panels">
        {visibleTabs.map((id) => (
          <TabsTab key={id} id={`side-tab-${id}`} value={id}>
            {TAB_LABEL[id]}
          </TabsTab>
        ))}
      </TabsList>
      {visibleTabs.map((id) => (
        <TabsPanel key={id} value={id} className="editor-side-tabpanel">
          {id === "comments" ? (
            <CommentsPanel run={run} hideButton={hideButton} />
          ) : id === "history" ? (
            <HistoryPanel run={run} hideButton={hideButton} />
          ) : id === "assistant" ? (
            <Suspense fallback={<p role="status">Loading the assistant…</p>}>
              <AssistantPanel hideButton={hideButton} />
            </Suspense>
          ) : (
            <MediaBin run={run} hideButton={hideButton} />
          )}
        </TabsPanel>
      ))}
    </Tabs>
  );
}
