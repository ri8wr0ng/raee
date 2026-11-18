import type { ReactNode } from "react";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { MediaBin } from "./media-bin";
import { CommentsPanel } from "./comments-panel";
import { HistoryPanel } from "./history-panel";
import { SIDE_TABS, type SideTab } from "./panel-sizes";

const TAB_LABEL: Record<SideTab, string> = {
  media: "Media",
  comments: "Comments",
  history: "History",
};

/** The left column: Media, Comments and History share one panel; switching is instant. */
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
  return (
    <Tabs
      id="side-panel"
      className="editor-side-panel"
      value={tab}
      onValueChange={(next) => next && onTab(next)}
    >
      <TabsList className="editor-side-tabs" aria-label="Side panels">
        {SIDE_TABS.map((id) => (
          <TabsTab key={id} id={`side-tab-${id}`} value={id}>
            {TAB_LABEL[id]}
          </TabsTab>
        ))}
      </TabsList>
      {SIDE_TABS.map((id) => (
        <TabsPanel key={id} value={id} className="editor-side-tabpanel">
          {id === "comments" ? (
            <CommentsPanel run={run} hideButton={hideButton} />
          ) : id === "history" ? (
            <HistoryPanel run={run} hideButton={hideButton} />
          ) : (
            <MediaBin run={run} hideButton={hideButton} />
          )}
        </TabsPanel>
      ))}
    </Tabs>
  );
}
