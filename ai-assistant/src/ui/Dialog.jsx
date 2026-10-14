// The one dialog slot: the assistant dialog the composer's Assistant
// button opens (api.ui.openDialog({ extraProps: { composerId } })).

import { AssistantDialog } from './AssistantDialog.jsx';

export function Dialog(props) {
  return <AssistantDialog {...props} />;
}
