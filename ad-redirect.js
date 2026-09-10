export const APP_STORE_URL =
  "https://apps.apple.com/us/app/farm-rush-fever/id6768553123";

export function createInputRedirect(navigate = (url) => window.location.assign(url)) {
  let inputs = 0;
  let redirected = false;
  return {
    record() {
      if (redirected) return false;
      inputs += 1;
      if (inputs < 10) return true;
      redirected = true;
      navigate(APP_STORE_URL);
      return false;
    },
    reset() {
      inputs = 0;
      redirected = false;
    },
  };
}
