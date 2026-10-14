// The one dialog slot, shared by every view the plugin opens with
// api.ui.openDialog({ extraProps: { view } }).

import { ComposerDialog } from './Composer.jsx';

export function Dialog(props) {
  return <ComposerDialog {...props} />;
}
