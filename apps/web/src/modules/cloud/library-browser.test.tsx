// @vitest-environment happy-dom
import "../../test/dom-setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { LibraryBrowser } from "./library-browser";

it("restores an archived item and opens it in the editor", async () => {
  const id = "media_1" as never;
  const bulk = vi.fn().mockResolvedValue(undefined);
  const onEdit = vi.fn();

  render(
    <LibraryBrowser
      items={[
        {
          _id: id,
          name: "Archived clip.mp4",
          archived: true,
        } as never,
      ]}
      folders={[]}
      filter={{ sort: "newest", archived: true }}
      onFilter={vi.fn()}
      readOnly={false}
      createFolder={vi.fn()}
      bulk={bulk}
      onEdit={onEdit}
    />,
  );

  await userEvent.click(
    screen.getByRole("button", { name: "Restore Archived clip.mp4 and open it in the editor" }),
  );

  await waitFor(() => {
    expect(bulk).toHaveBeenCalledWith({ mediaIds: [id], operation: "restore" });
    expect(onEdit).toHaveBeenCalledWith(id);
  });
});
