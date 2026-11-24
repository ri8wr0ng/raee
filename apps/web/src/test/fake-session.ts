// A stand-in for `workspace/editor-session`, for panels that only read the project and the playhead.
import { decodeProjectFile, type Project } from "@raee/contracts/project";
import { Time } from "@raee/contracts/time";

export function fakeProject(project: Record<string, unknown>): Project {
  return decodeProjectFile({ revision: 1, project }).project;
}

export function fakeEditorSession(project: Project) {
  const noop = () => {};
  const session = {
    native: false,
    apply: noop,
    importFiles: noop,
    watchFolder: noop,
    relinkMedia: noop,
    resource: async () => null,
  };
  const editorState = { playhead: new Time(0n), select: noop, seek: noop };
  const snapshot = {
    project,
    revision: 1,
    readOnly: false,
    busy: false,
    mediaAvailability: {},
  };
  return {
    useEditorSession: () => ({ session, snapshot, editor: { getState: () => editorState } }),
    useEditorView: <T>(selector: (state: typeof editorState) => T) => selector(editorState),
  };
}
