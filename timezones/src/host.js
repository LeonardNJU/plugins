// The host api, in the background and in every slot iframe. The bundle is
// evaluated with `require('@plugin-host')`; unit tests set a fake one.

let hostApi = null;
try {
  // eslint-disable-next-line no-undef
  hostApi = typeof require === 'function' ? require('@plugin-host') : null;
} catch {
  hostApi = null;
}

export function getApi() {
  return hostApi;
}

export function setApi(api) {
  hostApi = api;
}

export function t(key, vars) {
  return hostApi ? hostApi.i18n.t(key, vars) : key;
}

export function locale() {
  try {
    return hostApi?.i18n?.getLocale?.() || 'en';
  } catch {
    return 'en';
  }
}
