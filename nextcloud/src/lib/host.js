// The api object inside a slot iframe. Background code gets it through
// activate(api); slot components ask the runtime for it here. Tests set it.

let hostApi = null;

export function getApi() {
  if (!hostApi && typeof require === 'function') {
    // eslint-disable-next-line no-undef
    hostApi = require('@plugin-host');
  }
  return hostApi;
}

export function setApi(api) {
  hostApi = api;
}
